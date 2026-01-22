export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";

// Initialize admin SDK once
if (!admin.apps.length) {
    if (process.env.FIREBASE_ADMIN_CREDENTIALS) {
        try {
            const creds = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);
            admin.initializeApp({ credential: admin.credential.cert(creds) });
        } catch (err) {
            console.error("Failed to parse FIREBASE_ADMIN_CREDENTIALS", err);
            admin.initializeApp();
        }
    } else {
        admin.initializeApp();
    }
}

const db = admin.firestore();

export async function POST(request: NextRequest) {
    try {
        // Get Firebase Auth token from Authorization header
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { error: "Unauthorized - No token provided" },
                { status: 401 },
            );
        }

        const token = authHeader.split("Bearer ")[1];
        let decodedToken;

        try {
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch (err) {
            console.error("Token verification failed:", err);
            return NextResponse.json(
                { error: "Unauthorized - Invalid token" },
                { status: 401 },
            );
        }

        const userId = decodedToken.uid;
        const body = await request.json();
        const { plan } = body;

        // Validate plan
        const validPlans = ["free", "basic", "plus", "pro"];
        if (!plan || !validPlans.includes(plan)) {
            return NextResponse.json(
                { error: "Invalid plan" },
                { status: 400 },
            );
        }

        // Get current subscription
        const userDoc = await db.collection("users").doc(userId).get();
        const currentSubscription = userDoc.exists
            ? userDoc.data()?.subscription
            : null;

        // Update subscription - for downgrades, keep the subscription structure but change the plan
        const updatedSubscription = {
            ...currentSubscription,
            plan: plan,
            status: "active",
            startDate:
                currentSubscription?.startDate || new Date().toISOString(),
            // Clear billing info for free plan
            ...(plan === "free" && {
                billingKey: undefined,
                customerKey: undefined,
                isRecurring: false,
                nextBillingDate: undefined,
                amount: 0,
            }),
        };

        // Remove undefined fields
        Object.keys(updatedSubscription).forEach(
            (key) =>
                updatedSubscription[key] === undefined &&
                delete updatedSubscription[key],
        );

        await db.collection("users").doc(userId).set(
            {
                subscription: updatedSubscription,
                plan: plan, // Also update root-level plan field
                updatedAt: new Date().toISOString(),
            },
            { merge: true },
        );

        return NextResponse.json({
            success: true,
            userId,
            plan,
            subscription: updatedSubscription,
        });
    } catch (err) {
        console.error("/api/subscription/change-plan error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
