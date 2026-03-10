/**
 * Check user subscription status
 * GET /api/debug/subscription?userId=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

export async function GET(request: NextRequest) {
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

        const userDoc = await db.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data();
        const subscription = userData?.subscription || null;
        
        // Check if billing is due
        const now = new Date();
        const nextBillingDate = subscription?.nextBillingDate
            ? new Date(subscription.nextBillingDate)
            : null;
        
        const billingDue = nextBillingDate ? nextBillingDate <= now : false;
        const timeUntilBilling = nextBillingDate
            ? Math.round((nextBillingDate.getTime() - now.getTime()) / 1000)
            : null;

        return NextResponse.json({
            userId,
            subscription,
            billingStatus: {
                isDue: billingDue,
                nextBillingDate: subscription?.nextBillingDate || null,
                timeUntilBillingSeconds: timeUntilBilling,
                currentTime: now.toISOString(),
            },
            rawData: userData,
        });
    } catch (error) {
        console.error("Debug subscription error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal error" },
            { status: 500 }
        );
    }
}
