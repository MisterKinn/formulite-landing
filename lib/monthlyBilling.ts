// Monthly Billing Scheduler
// This should be called by a cron job or cloud function once per day
// to charge users whose nextBillingDate has passed

import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
} from "firebase/firestore";
import { getFirebaseApp } from "../firebaseConfig";
import { saveSubscription, getNextBillingDate } from "./subscription";

function getDb() {
    return getFirestore(getFirebaseApp());
}

export async function processMonthlyBilling() {
    try {
        const db = getDb();
        const today = new Date().toISOString().split("T")[0];

        // Get all active subscriptions with billing date <= today
        const usersRef = collection(db, "users");
        const q = query(
            usersRef,
            where("subscription.status", "==", "active"),
            where("subscription.nextBillingDate", "<=", today)
        );

        const snapshot = await getDocs(q);
        const results = [];

        for (const doc of snapshot.docs) {
            const userData = doc.data();
            const subscription = userData.subscription;

            if (!subscription.billingKey || !subscription.amount) {
                console.log(`Skipping user ${doc.id}: Missing billing data`);
                continue;
            }

            try {
                // Call billing API
                const response = await fetch(
                    `${
                        process.env.NEXT_PUBLIC_APP_URL ||
                        "http://localhost:3000"
                    }/api/payment/billing`,
                    {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            billingKey: subscription.billingKey,
                            customerKey: subscription.customerKey,
                            amount: subscription.amount,
                            orderId: `monthly_${doc.id}_${Date.now()}`,
                            orderName: `Nova AI ${
                                subscription.plan === "plus" ? "플러스" : "프로"
                            } 월간 구독`,
                        }),
                    }
                );

                const data = await response.json();

                if (response.ok) {
                    // Update next billing date
                    await saveSubscription(doc.id, {
                        ...subscription,
                        nextBillingDate: getNextBillingDate(),
                    });

                    results.push({
                        userId: doc.id,
                        success: true,
                        amount: subscription.amount,
                    });

                    console.log(
                        `✅ Billed user ${doc.id}: ${subscription.amount}원`
                    );
                } else {
                    console.error(
                        `❌ Failed to bill user ${doc.id}:`,
                        data.error
                    );

                    // TODO: Handle failed payment (send notification, retry, or cancel)
                    results.push({
                        userId: doc.id,
                        success: false,
                        error: data.error,
                    });
                }
            } catch (error) {
                console.error(`Error processing billing for ${doc.id}:`, error);
                results.push({
                    userId: doc.id,
                    success: false,
                    error: String(error),
                });
            }
        }

        return {
            success: true,
            processed: results.length,
            results,
        };
    } catch (error) {
        console.error("Monthly billing process error:", error);
        return {
            success: false,
            error: String(error),
        };
    }
}

// Manual trigger endpoint (for testing or manual runs)
export async function triggerMonthlyBilling() {
    console.log("🔄 Starting monthly billing process...");
    const result = await processMonthlyBilling();
    console.log("✅ Monthly billing completed:", result);
    return result;
}
