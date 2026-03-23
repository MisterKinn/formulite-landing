import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import {
    buildUsageResetFields,
    getStoredExtraTokenBalance,
    getStoredUsageTokens,
    inferPaidPlanFromPayment,
    needsUsageResetFromLimitMigration,
    needsUsageResetFromPayment,
    resolveEffectiveUsageLimit,
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
            const paymentData = paymentDoc.data() as Record<string, unknown>;
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
    } catch {
        // Fallback when some payment docs miss approvedAt/index in production data.
        const paymentsSnap = await userRef.collection("payments").limit(50).get();

        for (const paymentDoc of paymentsSnap.docs) {
            const paymentData = paymentDoc.data() as Record<string, unknown>;
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
    userData: Record<string, unknown>,
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
        const now = new Date();

        // Recover from legacy/broken state: payments exist but root user doc is missing.
        if (!userDoc.exists) {
            const inferredFromPayments = await resolvePlanFromPayments(userRef);
            await userRef.set(
                {
                    plan: inferredFromPayments.plan,
                    tier: inferredFromPayments.plan,
                    aiCallUsage: 0,
                    aiUsageMode: "tokens",
                    extraTokenBalance: 0,
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
            userData as Record<string, unknown>,
        );
        const plan = planResolved.plan;
        let currentUsage = getStoredUsageTokens(userData as Record<string, unknown>);
        const resetDecision = needsUsageResetFromPayment(
            userData as Record<string, unknown>,
            plan,
        );
        const migrationResetDecision = needsUsageResetFromLimitMigration(
            userData as Record<string, unknown>,
            now,
        );

        const resetAt =
            migrationResetDecision.resetAt ||
            resetDecision.resetAt ||
            planResolved.resetAt;
        if (
            migrationResetDecision.shouldReset ||
            resetDecision.shouldReset ||
            (!!resetAt && plan !== "free")
        ) {
            const extraTokenBalance = getStoredExtraTokenBalance(
                userData as Record<string, unknown>,
            );
            await userDoc.ref.update(
                buildUsageResetFields(resetAt, extraTokenBalance),
            );
            currentUsage = 0;
        }

        const baseLimit = resolveEffectiveUsageLimit(
            userData as Record<string, unknown>,
            plan,
            now,
        );
        const extraTokenBalance = getStoredExtraTokenBalance(
            userData as Record<string, unknown>,
        );
        const limit = baseLimit + extraTokenBalance;
        const remaining = Math.max(
            0,
            Math.max(0, baseLimit - currentUsage) + extraTokenBalance,
        );
        const canUse = remaining > 0;

        return NextResponse.json({
            success: true,
            plan,
            currentUsage,
            limit,
            remaining,
            canUse,
            usageUnit: "tokens",
            subscriptionLimit: baseLimit,
            extraTokenBalance,
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
