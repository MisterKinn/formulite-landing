#!/usr/bin/env node
"use strict";

/**
 * Backfill users/{uid} documents to unified schema.
 *
 * Usage:
 *   node scripts/backfill_users_firestore.js --dry-run
 *   node scripts/backfill_users_firestore.js --apply
 */

const admin = require("firebase-admin");

function initAdmin() {
    if (admin.apps.length > 0) return admin;

    const json = process.env.FIREBASE_ADMIN_CREDENTIALS;
    const b64 = process.env.FIREBASE_ADMIN_CREDENTIALS_B64;

    if (json) {
        admin.initializeApp({
            credential: admin.credential.cert(JSON.parse(json)),
        });
        return admin;
    }

    if (b64) {
        const parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
        admin.initializeApp({
            credential: admin.credential.cert(parsed),
        });
        return admin;
    }

    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
    return admin;
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeDate(value) {
    if (typeof value === "string") {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return nowIso();
}

function sanitize(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => sanitize(item));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        out[k] = sanitize(v);
    }
    return out;
}

function inferPlan(amount, billingCycle, fallbackPlan) {
    if (billingCycle === "test") return "test";
    if (typeof amount === "number") {
        if (amount === 11900 || amount === 99960) return "go";
        if (amount >= 99000) return "pro";
        if (amount >= 29900) return "plus";
        if (amount >= 11900) return "go";
        return "free";
    }
    if (typeof fallbackPlan === "string") return fallbackPlan;
    return "free";
}

async function run() {
    const apply = process.argv.includes("--apply");
    const dryRun = !apply;

    initAdmin();
    const db = admin.firestore();
    const usersSnapshot = await db.collection("users").get();

    let scanned = 0;
    let changed = 0;
    let migratedLegacySub = 0;
    const sample = [];

    for (const userDoc of usersSnapshot.docs) {
        scanned += 1;
        const uid = userDoc.id;
        const data = userDoc.data() || {};

        const legacySubDoc = await db
            .collection("users")
            .doc(uid)
            .collection("subscription")
            .doc("current")
            .get();

        const legacySubscription = legacySubDoc.exists ? legacySubDoc.data() : null;
        const resolvedSubscription = data.subscription || legacySubscription || null;
        if (!data.subscription && legacySubscription) {
            migratedLegacySub += 1;
        }

        const resolvedPlan = inferPlan(
            resolvedSubscription && typeof resolvedSubscription.amount === "number"
                ? resolvedSubscription.amount
                : undefined,
            resolvedSubscription && resolvedSubscription.billingCycle,
            resolvedSubscription?.plan || data.plan,
        );

        const patch = sanitize({
            avatar: data.avatar ?? data.photoURL ?? null,
            displayName: data.displayName ?? null,
            email: data.email ?? null,
            createdAt: normalizeDate(data.createdAt),
            updatedAt: nowIso(),
            aiCallUsage:
                typeof data.aiCallUsage === "number" ? data.aiCallUsage : 0,
            plan: resolvedPlan,
            ...(resolvedSubscription
                ? {
                      subscription: {
                          ...resolvedSubscription,
                          plan: resolvedSubscription.plan || resolvedPlan,
                      },
                  }
                : {}),
        });

        const before = JSON.stringify({
            avatar: data.avatar ?? data.photoURL ?? null,
            displayName: data.displayName ?? null,
            email: data.email ?? null,
            createdAt: data.createdAt,
            aiCallUsage:
                typeof data.aiCallUsage === "number" ? data.aiCallUsage : 0,
            plan: data.plan || resolvedSubscription?.plan || "free",
            subscription: data.subscription || null,
        });
        const after = JSON.stringify({
            avatar: patch.avatar,
            displayName: patch.displayName,
            email: patch.email,
            createdAt: patch.createdAt,
            aiCallUsage: patch.aiCallUsage,
            plan: patch.plan,
            subscription: patch.subscription || null,
        });

        if (before !== after) {
            changed += 1;
            if (sample.length < 10) {
                sample.push({
                    uid,
                    planFrom: data.plan || null,
                    planTo: patch.plan,
                    migratedLegacySubscription: !!(!data.subscription && legacySubscription),
                });
            }

            if (apply) {
                await userDoc.ref.set(patch, { merge: true });
            }
        }
    }

    const mode = dryRun ? "DRY_RUN" : "APPLY";
    console.log(`[backfill_users_firestore] mode=${mode}`);
    console.log(`[backfill_users_firestore] scanned=${scanned}`);
    console.log(`[backfill_users_firestore] changed=${changed}`);
    console.log(
        `[backfill_users_firestore] migratedLegacySubscription=${migratedLegacySub}`,
    );
    console.log(
        `[backfill_users_firestore] sample=${JSON.stringify(sample, null, 2)}`,
    );
}

run().catch((error) => {
    console.error("[backfill_users_firestore] failed", error);
    process.exitCode = 1;
});
