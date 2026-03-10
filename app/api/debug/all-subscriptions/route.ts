/**
 * List all active subscriptions
 * GET /api/debug/all-subscriptions
 */

import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

export async function GET(request: NextRequest) {
    try {
        const admin = getFirebaseAdmin();
        const db = admin.firestore();

        const snapshot = await db
            .collection("users")
            .where("subscription.status", "==", "active")
            .get();

        const now = new Date();

        const subscriptions = snapshot.docs.map((doc) => {
            const data = doc.data();
            const sub = data.subscription || {};
            const nextBilling = sub.nextBillingDate
                ? new Date(sub.nextBillingDate)
                : null;

            return {
                userId: doc.id,
                email: data.email || null,
                plan: sub.plan,
                amount: sub.amount,
                billingCycle: sub.billingCycle,
                isRecurring: sub.isRecurring,
                nextBillingDate: sub.nextBillingDate,
                isDue: nextBilling ? nextBilling <= now : false,
                timeUntilDue: nextBilling
                    ? Math.round((nextBilling.getTime() - now.getTime()) / 1000)
                    : null,
            };
        });

        return NextResponse.json({
            count: subscriptions.length,
            currentTime: now.toISOString(),
            subscriptions,
        });
    } catch (error) {
        console.error("List subscriptions error:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error ? error.message : "Internal error",
            },
            { status: 500 },
        );
    }
}
