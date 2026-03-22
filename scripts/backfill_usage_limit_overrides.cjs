const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const LEGACY_LIMIT_OVERRIDE_UNTIL = "2026-04-01T00:00:00+09:00";
const ESTIMATED_TOKENS_PER_PROBLEM = 25000;
const LEGACY_LIMITS = {
    free: 5 * ESTIMATED_TOKENS_PER_PROBLEM,
    go: 110 * ESTIMATED_TOKENS_PER_PROBLEM,
    plus: 330 * ESTIMATED_TOKENS_PER_PROBLEM,
    pro: 2200 * ESTIMATED_TOKENS_PER_PROBLEM,
};

const PRODUCT_KEYWORDS = ["요금제", "구독", "plan", "pricing"];
const KNOWN_PRODUCT_AMOUNTS = new Set([
    60,
    100,
    120,
    720,
    840,
    11900,
    29900,
    59400,
    99000,
    99960,
    251160,
    712800,
    831600,
]);

function readServiceAccount() {
    const rawCredentials = String(process.env.FIREBASE_ADMIN_CREDENTIALS || "").trim();
    if (rawCredentials) {
        return JSON.parse(rawCredentials);
    }

    const credentialsPath = String(
        process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
    ).trim();
    if (!credentialsPath) {
        throw new Error(
            "GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_ADMIN_CREDENTIALS is required",
        );
    }

    const resolvedPath = path.resolve(credentialsPath);
    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function isProductPayment(payment) {
    const orderName = String(payment.orderName || "").toLowerCase();
    if (PRODUCT_KEYWORDS.some((keyword) => orderName.includes(keyword))) {
        return true;
    }

    if (
        orderName.includes("monthly") ||
        orderName.includes("yearly") ||
        orderName.includes("annual") ||
        orderName.includes("월간") ||
        orderName.includes("연간")
    ) {
        return true;
    }

    return KNOWN_PRODUCT_AMOUNTS.has(Number(payment.amount || 0));
}

function inferPlan(payment) {
    const orderName = String(payment.orderName || "").toLowerCase();
    const amount = Number(payment.amount || 0);

    if (orderName.includes("ultra") || orderName.includes("pro")) return "pro";
    if (orderName.includes("plus")) return "plus";
    if (orderName.includes("go")) return "go";

    if ([99000, 831600, 712800, 59400].includes(amount)) return "pro";
    if ([29900, 251160, 60, 100, 120, 720, 840].includes(amount)) return "plus";
    if ([11900, 99960].includes(amount)) return "go";

    if (amount >= 11900 && amount < 29900) return "go";
    if (amount > 29900 && amount < 99000) return "plus";
    if (amount > 99000) return "pro";
    if (amount > 0) return "plus";
    return "free";
}

function parseApprovedAt(value) {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

async function main() {
    const serviceAccount = readServiceAccount();
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id,
        });
    }

    const db = admin.firestore();
    const latestPaidByUserId = new Map();
    const usersSnapshot = await db.collection("users").get();

    for (const userDoc of usersSnapshot.docs) {
        const paymentsSnapshot = await userDoc.ref.collection("payments").get();
        paymentsSnapshot.forEach((paymentDoc) => {
            const payment = paymentDoc.data();
            if (String(payment.status || "") !== "DONE" || !isProductPayment(payment)) {
                return;
            }

            const approvedAtMs = parseApprovedAt(payment.approvedAt);
            const previous = latestPaidByUserId.get(userDoc.id);
            if (!previous || approvedAtMs > previous.approvedAtMs) {
                latestPaidByUserId.set(userDoc.id, {
                    plan: inferPlan(payment),
                    approvedAtMs,
                });
            }
        });
    }

    if (latestPaidByUserId.size === 0) {
        console.log("No paid users found to grandfather.");
        return;
    }

    const nowIso = new Date().toISOString();
    const batchSize = 400;
    const entries = Array.from(latestPaidByUserId.entries());
    let updatedCount = 0;

    for (let i = 0; i < entries.length; i += batchSize) {
        const batch = db.batch();
        const slice = entries.slice(i, i + batchSize);

        slice.forEach(([userId, info]) => {
            const limit = LEGACY_LIMITS[info.plan] || LEGACY_LIMITS.free;
            const userRef = db.collection("users").doc(userId);
            batch.set(
                userRef,
                {
                    aiLimitOverride: limit,
                    aiLimitOverrideUntil: LEGACY_LIMIT_OVERRIDE_UNTIL,
                    updatedAt: nowIso,
                },
                { merge: true },
            );
            updatedCount += 1;
        });

        await batch.commit();
    }

    console.log(
        `Grandfathered ${updatedCount} paid users until ${LEGACY_LIMIT_OVERRIDE_UNTIL}.`,
    );
}

main().catch((error) => {
    console.error("Failed to backfill usage limit overrides:", error);
    process.exitCode = 1;
});
