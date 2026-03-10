/*
Simple helper script to set a subscription field on a Firestore user document.
Usage:
  node scripts/add_subscription.js <USER_ID> <PLAN>

Requires one of:
 - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account JSON file, OR
 - set FIREBASE_ADMIN_CREDENTIALS to the raw JSON string of a service account

This script is meant to be run locally and not committed with secrets.
*/

const admin = require("firebase-admin");
const fs = require("fs");

async function main() {
    const [, , userId, plan] = process.argv;
    if (!userId || !plan) {
        console.error(
            "Usage: node scripts/add_subscription.js <USER_ID> <PLAN>"
        );
        process.exit(1);
    }

    // Initialize admin
    if (!admin.apps.length) {
        if (process.env.FIREBASE_ADMIN_CREDENTIALS) {
            const creds = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);
            admin.initializeApp({ credential: admin.credential.cert(creds) });
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            admin.initializeApp();
        } else if (fs.existsSync("./serviceAccountKey.json")) {
            const creds = require("./serviceAccountKey.json");
            admin.initializeApp({ credential: admin.credential.cert(creds) });
        } else {
            console.error(
                "No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_ADMIN_CREDENTIALS or place serviceAccountKey.json in project root."
            );
            process.exit(1);
        }
    }

    const db = admin.firestore();
    const now = new Date().toISOString();
    const subscription = {
        plan: plan,
        amount: plan === "test" ? 0 : 9900,
        startDate: now,
        status: "active",
    };

    try {
        await db
            .collection("users")
            .doc(userId)
            .set({ subscription }, { merge: true });
        console.log(`Saved subscription for ${userId}:`, subscription);
        process.exit(0);
    } catch (err) {
        console.error("Failed to save subscription:", err);
        process.exit(1);
    }
}

main();
