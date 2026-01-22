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

        // Determine the correct amount for the new plan
        const planAmounts: Record<string, number> = {
            free: 0,
            basic: 9900,
            plus: 19900,
            pro: 29900,
        };
        const newAmount = planAmounts[plan] || 0;

        // Plan display names for orderName
        const planNames: Record<string, string> = {
            free: "무료",
            basic: "베이직",
            plus: "플러스",
            pro: "프로",
        };

        // If downgrading to free OR changing to a different paid plan, delete the billing key
        const shouldDeleteBillingKey = 
            currentSubscription?.billingKey && 
            (plan === "free" || newAmount !== currentSubscription?.amount);

        if (shouldDeleteBillingKey && currentSubscription?.billingKey) {
            try {
                const secretKey = process.env.TOSS_SECRET_KEY!;
                const encodedKey = Buffer.from(secretKey + ":").toString("base64");

                await fetch(
                    `https://api.tosspayments.com/v1/billing/authorizations/${currentSubscription.billingKey}`,
                    {
                        method: "DELETE",
                        headers: {
                            Authorization: `Basic ${encodedKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            customerKey: currentSubscription.customerKey,
                        }),
                    }
                );
            } catch (err) {
                console.error("Failed to delete billing key from TossPayments:", err);
                // Continue anyway - we still want to update our database
            }
        }

        // Update subscription - for downgrades, update the plan and amount
        const updatedSubscription = {
            ...currentSubscription,
            plan: plan,
            amount: newAmount,
            orderName: `Nova AI ${planNames[plan]} 요금제`,
            status: plan === "free" ? "cancelled" : "active",
            startDate:
                currentSubscription?.startDate || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // Clear billing info when changing plans (user needs to re-register card for new amount)
            ...(shouldDeleteBillingKey && {
                billingKey: null,
                customerKey: null,
                isRecurring: false,
                nextBillingDate: null,
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
