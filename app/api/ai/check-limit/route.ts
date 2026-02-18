import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { getTierLimit } from "@/lib/tierLimits";
import {
    buildUsageResetFields,
    inferPaidPlanFromPayment,
    needsUsageResetFromPayment,
    resolveEffectiveUsagePlan,
} from "@/lib/aiUsage";
import { PlanTier } from "@/lib/tierLimits";

function resolveUsageProxyBaseUrl(): string {
    const base = (process.env.NOVA_USAGE_API_BASE_URL || "").trim();
    return base.replace(/\/+$/, "");
}

function shouldProxyUsageRequest(baseUrl: string): boolean {
    if (!baseUrl) return false;
    const selfHosts = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
    return !selfHosts.has(baseUrl);
}

async function resolvePlanFromPayments(
    userRef: FirebaseFirestore.DocumentReference,
): Promise<{ plan: PlanTier; resetAt?: string }> {
    try {
        const paymentsSnap = await userRef
            .collection("payments")
            .orderBy("approvedAt", "desc")
            .limit(20)
            .get();

        for (const paymentDoc of paymentsSnap.docs) {
            const paymentData = paymentDoc.data() as any;
            const inferred = inferPaidPlanFromPayment(paymentData);
            if (inferred !== "free") {
                return {
                    plan: inferred,
                    resetAt:
                        typeof paymentData?.approvedAt === "string"
                            ? paymentData.approvedAt
                            : undefined,
                };
            }
        }
    } catch (orderedQueryError) {
        // Fallback when some payment docs miss approvedAt/index in production data.
        const paymentsSnap = await userRef.collection("payments").limit(50).get();

        for (const paymentDoc of paymentsSnap.docs) {
            const paymentData = paymentDoc.data() as any;
            const inferred = inferPaidPlanFromPayment(paymentData);
            if (inferred !== "free") {
                return {
                    plan: inferred,
                    resetAt:
                        typeof paymentData?.approvedAt === "string"
                            ? paymentData.approvedAt
                            : undefined,
                };
            }
        }
    }

    return { plan: "free" };
}

async function resolvePlanWithPaymentFallback(
    userRef: FirebaseFirestore.DocumentReference,
    userData: Record<string, any>,
): Promise<{ plan: PlanTier; resetAt?: string }> {
    const resolved = resolveEffectiveUsagePlan(userData);
    if (resolved !== "free") return { plan: resolved };
    return resolvePlanFromPayments(userRef);
}

/**
 * Check if user can make an AI call
 * GET /api/ai/check-limit?userId={userId}
 */
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json(
                { error: "userId is required" },
                { status: 400 }
            );
        }

        const proxyBaseUrl = resolveUsageProxyBaseUrl();
        if (shouldProxyUsageRequest(proxyBaseUrl)) {
            const upstreamUrl = `${proxyBaseUrl}/api/ai/check-limit?userId=${encodeURIComponent(
                userId,
            )}`;
            const upstream = await fetch(upstreamUrl, {
                method: "GET",
                cache: "no-store",
                headers: {
                    "Cache-Control": "no-cache",
                },
            });
            const body = await upstream.text();
            return new NextResponse(body, {
                status: upstream.status,
                headers: {
                    "Content-Type":
                        upstream.headers.get("content-type") || "application/json",
                    "Cache-Control": "no-store, no-cache, must-revalidate",
                },
            });
        }

        const admin = await getFirebaseAdmin();
        const db = admin.firestore();
        const userRef = db.collection("users").doc(userId);
        let userDoc = await userRef.get();
        const nowIso = new Date().toISOString();

        // Recover from legacy/broken state: payments exist but root user doc is missing.
        if (!userDoc.exists) {
            const inferredFromPayments = await resolvePlanFromPayments(userRef);
            await userRef.set(
                {
                    plan: inferredFromPayments.plan,
                    tier: inferredFromPayments.plan,
                    aiCallUsage: 0,
                    usageResetAt: inferredFromPayments.resetAt || nowIso,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                },
                { merge: true },
            );
            userDoc = await userRef.get();
        }

        const userData = userDoc.data() || {};
        const planResolved = await resolvePlanWithPaymentFallback(
            userRef,
            userData as Record<string, any>,
        );
        const plan = planResolved.plan;
        let currentUsage = userData.aiCallUsage || 0;
        const resetDecision = needsUsageResetFromPayment(
            userData as Record<string, any>,
            plan,
        );

        const resetAt = resetDecision.resetAt || planResolved.resetAt;
        if (resetDecision.shouldReset || (!!resetAt && plan !== "free")) {
            await userDoc.ref.update(buildUsageResetFields(resetAt));
            currentUsage = 0;
        }

        const limit = getTierLimit(plan);
        const canUse = currentUsage < limit;

        return NextResponse.json({
            success: true,
            plan,
            currentUsage,
            limit,
            remaining: Math.max(0, limit - currentUsage),
            canUse,
        }, {
            headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate",
            },
        });
    } catch (error) {
        console.error("Error checking AI limit:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
