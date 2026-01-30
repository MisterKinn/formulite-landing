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

/**
 * POST /api/billing/update-card
 * Updates the user's billing key with a new card
 * Body: { billingKey, customerKey }
 */
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
        const { billingKey, customerKey } = body;

        if (!billingKey || !customerKey) {
            return NextResponse.json(
                { error: "Missing billingKey or customerKey" },
                { status: 400 },
            );
        }

        // Get current subscription
        const userDoc = await db.collection("users").doc(userId).get();
        const currentSubscription = userDoc.exists
            ? userDoc.data()?.subscription
            : null;

        if (!currentSubscription) {
            return NextResponse.json(
                { error: "No subscription found" },
                { status: 404 },
            );
        }

        // Delete old billing key from TossPayments if exists
        if (currentSubscription.billingKey && currentSubscription.customerKey) {
            try {
                // 빌링키 삭제에는 빌링 전용 시크릿 키 사용
                const secretKey =
                    process.env.TOSS_BILLING_SECRET_KEY ||
                    process.env.TOSS_SECRET_KEY!;
                const encodedKey = Buffer.from(secretKey + ":").toString(
                    "base64",
                );

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
                    },
                );
            } catch (err) {
                console.error("Failed to delete old billing key:", err);
                // Continue anyway - we still want to update to new card
            }
        }

        // Update subscription with new billing key
        await db
            .collection("users")
            .doc(userId)
            .set(
                {
                    subscription: {
                        ...currentSubscription,
                        billingKey,
                        customerKey,
                        updatedAt: new Date().toISOString(),
                        // Reset failure count when card is updated
                        failureCount: 0,
                        lastFailureDate: null,
                    },
                    updatedAt: new Date().toISOString(),
                },
                { merge: true },
            );

        return NextResponse.json({
            success: true,
            message: "Card updated successfully",
        });
    } catch (error) {
        console.error("Update card error:", error);
        return NextResponse.json(
            { error: "Failed to update card" },
            { status: 500 },
        );
    }
}
