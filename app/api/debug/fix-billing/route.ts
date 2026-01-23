/**
 * Fix user subscription - set nextBillingDate to 1 minute from now
 * POST /api/debug/fix-billing?userId=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { getNextBillingDate } from "@/lib/subscription";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json(
                { error: "userId is required" },
                { status: 400 }
            );
        }

        const admin = getFirebaseAdmin();
        const db = admin.firestore();

        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data();
        const subscription = userData?.subscription;

        if (!subscription) {
            return NextResponse.json(
                { error: "No subscription found" },
                { status: 400 }
            );
        }

        // Fix nextBillingDate to proper ISO format (1 minute from now for test)
        const nextBillingDate = getNextBillingDate(subscription.billingCycle || "monthly");

        await userRef.update({
            "subscription.nextBillingDate": nextBillingDate,
            "subscription.failureCount": 0,
            "subscription.lastFailureReason": null,
            "subscription.lastFailureDate": null,
        });

        return NextResponse.json({
            success: true,
            message: "Subscription fixed",
            nextBillingDate,
            billingCycle: subscription.billingCycle,
        });
    } catch (error) {
        console.error("Fix billing error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal error" },
            { status: 500 }
        );
    }
}
