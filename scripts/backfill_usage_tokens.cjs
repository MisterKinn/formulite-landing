const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const ESTIMATED_TOKENS_PER_PROBLEM = 25000;

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

function normalizeLegacyValue(rawValue) {
    const numeric = Number(rawValue || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    if (numeric < 10000) {
        return Math.floor(numeric) * ESTIMATED_TOKENS_PER_PROBLEM;
    }
    return Math.floor(numeric);
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
    const usersSnapshot = await db.collection("users").get();
    let updatedCount = 0;
    const batchSize = 400;
    const docs = usersSnapshot.docs;

    for (let i = 0; i < docs.length; i += batchSize) {
        const batch = db.batch();
        const slice = docs.slice(i, i + batchSize);

        slice.forEach((doc) => {
            const data = doc.data() || {};
            const updates = {};

            const currentUsage = normalizeLegacyValue(data.aiCallUsage);
            const currentOverride = normalizeLegacyValue(data.aiLimitOverride);

            if (String(data.aiUsageMode || "").toLowerCase() !== "tokens") {
                updates.aiUsageMode = "tokens";
            }

            if (data.aiCallUsage !== undefined && currentUsage !== Number(data.aiCallUsage || 0)) {
                updates.aiCallUsage = currentUsage;
            }

            if (
                data.aiLimitOverride !== undefined &&
                currentOverride !== Number(data.aiLimitOverride || 0)
            ) {
                updates.aiLimitOverride = currentOverride;
            }

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = new Date().toISOString();
                batch.set(doc.ref, updates, { merge: true });
                updatedCount += 1;
            }
        });

        await batch.commit();
    }

    console.log(`Converted ${updatedCount} user documents to token usage mode.`);
}

main().catch((error) => {
    console.error("Failed to backfill token usage data:", error);
    process.exitCode = 1;
});
