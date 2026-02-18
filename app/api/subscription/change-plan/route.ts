export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { buildUserRootPatch, sanitizeForFirestore } from "@/lib/userData";

const admin = getFirebaseAdmin();

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
        const { plan, billingCycle } = body;

        // Validate plan
        const validPlans = ["free", "go", "plus", "pro"];
        if (!plan || !validPlans.includes(plan)) {
            return NextResponse.json(
                { error: "Invalid plan" },
                { status: 400 },
            );
        }

        // Validate billing cycle
        const validCycles = ["monthly", "yearly"];
        const cycle = validCycles.includes(billingCycle)
            ? billingCycle
            : "monthly";

        // Get current subscription
        const userDoc = await db.collection("users").doc(userId).get();
        const currentSubscription = userDoc.exists
            ? userDoc.data()?.subscription
            : null;

        // Determine the correct amount for the new plan based on billing cycle
        const planAmounts: Record<string, { monthly: number; yearly: number }> =
            {
                free: { monthly: 0, yearly: 0 },
                go: { monthly: 11900, yearly: 99960 },
                plus: { monthly: 29900, yearly: 251160 },
                pro: { monthly: 99000, yearly: 831600 },
            };
        const newAmount =
            planAmounts[plan]?.[cycle as "monthly" | "yearly"] || 0;

        // Plan display names for orderName
        const planNames: Record<string, string> = {
            free: "Free",
            go: "Go",
            plus: "Plus",
            pro: "Ultra",
        };

        // Only delete billing key when downgrading to FREE plan
        // For paid plan changes, just update the amount (per TossPayments guide)
        const shouldDeleteBillingKey =
            plan === "free" && currentSubscription?.billingKey;

        if (shouldDeleteBillingKey) {
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
                console.error(
                    "Failed to delete billing key from TossPayments:",
                    err,
                );
                // Continue anyway - we still want to update our database
            }
        }

        // Update subscription - update amount, orderName, and billingCycle for plan changes
        // The scheduled billing will use the new amount automatically
        const updatedSubscription = sanitizeForFirestore({
            ...currentSubscription,
            plan: plan,
            amount: newAmount,
            billingCycle: cycle,
            orderName: `Nova AI ${planNames[plan]} 요금제`,
            status: plan === "free" ? "cancelled" : "active",
            startDate:
                currentSubscription?.startDate || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // Only clear billing info for free plan
            ...(shouldDeleteBillingKey && {
                billingKey: null,
                customerKey: null,
                isRecurring: false,
                nextBillingDate: null,
            }),
        });

        // Remove undefined fields
        Object.keys(updatedSubscription).forEach(
            (key) =>
                updatedSubscription[key] === undefined &&
                delete updatedSubscription[key],
        );

        await db.collection("users").doc(userId).set(
            buildUserRootPatch({
                existingUser: (userDoc.data() || {}) as Record<string, unknown>,
                subscription: updatedSubscription as Record<string, unknown>,
                plan: plan as "free" | "go" | "plus" | "pro",
            }),
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
