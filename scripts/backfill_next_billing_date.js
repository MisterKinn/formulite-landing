#!/usr/bin/env node
"use strict";

/**
 * Backfill users/{uid}.subscription.nextBillingDate with calendar-based rules.
 *
 * Rules:
 * - yearly: +1 calendar year from latest paid date
 * - monthly: +1 calendar month from latest paid date
 * - test: +1 minute from latest paid date
 *
 * Usage:
 *   node scripts/backfill_next_billing_date.js --dry-run
 *   node scripts/backfill_next_billing_date.js --apply
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

function loadEnvLocal() {
    const envPath = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
}

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

    const googleCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (googleCredentialsPath && fs.existsSync(googleCredentialsPath)) {
        const parsed = JSON.parse(fs.readFileSync(googleCredentialsPath, "utf8"));
        admin.initializeApp({
            credential: admin.credential.cert(parsed),
        });
        return admin;
    }

    const localServiceAccount = fs
        .readdirSync(process.cwd())
        .find((file) => /firebase-adminsdk.+\.json$/i.test(file));
    if (localServiceAccount) {
        const parsed = JSON.parse(
            fs.readFileSync(path.join(process.cwd(), localServiceAccount), "utf8"),
        );
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

function toDateOrNull(value) {
    if (typeof value !== "string" || !value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePlan(value) {
    if (typeof value !== "string") return "free";
    const normalized = value.trim().toLowerCase();
    if (normalized === "ultra") return "pro";
    if (["free", "go", "plus", "pro", "test"].includes(normalized)) {
        return normalized;
    }
    return "free";
}

function inferBillingCycle(subscription) {
    const cycleRaw = String(subscription?.billingCycle || "").toLowerCase();
    if (cycleRaw === "monthly" || cycleRaw === "yearly" || cycleRaw === "test") {
        return cycleRaw;
    }

    const amount = Number(subscription?.amount || 0);
    // Keep this conservative; only infer yearly for known yearly prices.
    if ([99960, 251160, 831600, 712800].includes(amount)) return "yearly";
    return "monthly";
}

function inferBillingCycleFromPayment(payment) {
    const cycleRaw = String(payment?.billingCycle || "").toLowerCase();
    if (cycleRaw === "monthly" || cycleRaw === "yearly" || cycleRaw === "test") {
        return cycleRaw;
    }

    const orderName = String(payment?.orderName || "").toLowerCase();
    if (orderName.includes("연간") || orderName.includes("yearly")) return "yearly";
    if (orderName.includes("월간") || orderName.includes("monthly")) return "monthly";

    const amount = Number(payment?.amount || 0);
    if ([99960, 251160, 831600, 712800].includes(amount)) return "yearly";
    return null;
}

function addCycle(baseDate, cycle) {
    const next = new Date(baseDate);
    if (cycle === "yearly") {
        next.setFullYear(next.getFullYear() + 1);
        return next;
    }
    if (cycle === "test") {
        next.setMinutes(next.getMinutes() + 1);
        return next;
    }
    next.setMonth(next.getMonth() + 1);
    return next;
}

async function getLatestDonePaymentInfo(db, uid) {
    const snapshot = await db
        .collection("users")
        .doc(uid)
        .collection("payments")
        .get();

    if (snapshot.empty) return null;

    let latestPayment = null;
    let latestDate = null;

    snapshot.forEach((doc) => {
        const payment = doc.data();
        if (String(payment.status || "").toUpperCase() !== "DONE") return;
        const approvedAt = toDateOrNull(payment.approvedAt);
        if (!approvedAt) return;
        if (!latestDate || approvedAt.getTime() > latestDate.getTime()) {
            latestDate = approvedAt;
            latestPayment = payment;
        }
    });

    if (!latestDate) return null;

    return {
        approvedAt: latestDate,
        cycle: inferBillingCycleFromPayment(latestPayment),
    };
}

async function run() {
    const apply = process.argv.includes("--apply");
    const dryRun = !apply;

    loadEnvLocal();
    initAdmin();
    const db = admin.firestore();

    const usersSnapshot = await db.collection("users").get();
    let scanned = 0;
    let skippedFree = 0;
    let skippedNoAnchor = 0;
    let changed = 0;
    const sample = [];

    for (const userDoc of usersSnapshot.docs) {
        scanned += 1;
        const uid = userDoc.id;
        const data = userDoc.data() || {};
        const subscription = data.subscription || {};
        const plan = normalizePlan(subscription.plan || data.plan || data.tier);

        if (plan === "free") {
            skippedFree += 1;
            continue;
        }

        const defaultCycle = inferBillingCycle(subscription);
        const latestDonePaymentInfo = await getLatestDonePaymentInfo(db, uid);
        const cycle = latestDonePaymentInfo?.cycle || defaultCycle;
        const fallbackAnchor =
            toDateOrNull(subscription.lastPaymentDate) ||
            toDateOrNull(subscription.startDate) ||
            toDateOrNull(subscription.registeredAt);
        const anchorDate = latestDonePaymentInfo?.approvedAt || fallbackAnchor;

        if (!anchorDate) {
            skippedNoAnchor += 1;
            continue;
        }

        const nextBillingDate = addCycle(anchorDate, cycle).toISOString();
        const currentNext = String(subscription.nextBillingDate || "");

        if (currentNext === nextBillingDate) {
            continue;
        }

        changed += 1;
        if (sample.length < 15) {
            sample.push({
                uid,
                plan,
                cycle,
                anchor: anchorDate.toISOString(),
                from: currentNext || null,
                to: nextBillingDate,
            });
        }

        if (apply) {
            await userDoc.ref.set(
                {
                    updatedAt: new Date().toISOString(),
                    subscription: {
                        ...subscription,
                        billingCycle: cycle,
                        nextBillingDate,
                    },
                },
                { merge: true },
            );
        }
    }

    const mode = dryRun ? "DRY_RUN" : "APPLY";
    console.log(`[backfill_next_billing_date] mode=${mode}`);
    console.log(`[backfill_next_billing_date] scanned=${scanned}`);
    console.log(`[backfill_next_billing_date] changed=${changed}`);
    console.log(`[backfill_next_billing_date] skippedFree=${skippedFree}`);
    console.log(
        `[backfill_next_billing_date] skippedNoAnchor=${skippedNoAnchor}`,
    );
    console.log(
        `[backfill_next_billing_date] sample=${JSON.stringify(sample, null, 2)}`,
    );
}

run().catch((error) => {
    console.error("[backfill_next_billing_date] failed", error);
    process.exitCode = 1;
});
