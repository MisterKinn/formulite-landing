import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { sendSubscriptionCancelledEmail } from "@/lib/email";
import {
    buildUserRootPatch,
    normalizePlanLike,
    sanitizeForFirestore,
} from "@/lib/userData";
import { resolveSubscriptionPeriodEnd } from "@/lib/aiUsage";

/**
 * 구독 취소 API
 * POST /api/billing/cancel
 *
 * TossPayments에서 빌링키를 삭제하고 Firestore에서 구독 상태를 업데이트합니다.
 */
export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { success: false, error: "인증 정보가 필요합니다" },
                { status: 401 },
            );
        }

        const admin = getFirebaseAdmin();
        const token = authHeader.split("Bearer ")[1];
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch {
            return NextResponse.json(
                { success: false, error: "유효하지 않은 인증 정보입니다" },
                { status: 401 },
            );
        }
        const requestBody = await request.json().catch(() => ({}));
        const requestedUserId =
            typeof requestBody?.userId === "string" ? requestBody.userId : undefined;
        const userId = decodedToken.uid;

        if (requestedUserId && requestedUserId !== userId) {
            return NextResponse.json(
                { success: false, error: "본인 구독만 해지할 수 있습니다" },
                { status: 403 },
            );
        }

        const db = admin.firestore();

        // Get user subscription data
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, error: "사용자를 찾을 수 없습니다" },
                { status: 404 },
            );
        }

        const userData = userDoc.data();
        const subscription = userData?.subscription;

        if (!subscription?.billingKey) {
            return NextResponse.json(
                { success: false, error: "등록된 빌링키가 없습니다" },
                { status: 400 },
            );
        }

        const { billingKey, customerKey } = subscription;

        // Delete billing key from TossPayments
        // 빌링키 삭제에는 빌링 전용 시크릿 키 사용
        const secretKey =
            process.env.TOSS_BILLING_SECRET_KEY || process.env.TOSS_SECRET_KEY!;
        const encodedKey = Buffer.from(secretKey + ":").toString("base64");

        const response = await fetch(
            `https://api.tosspayments.com/v1/billing/authorizations/${billingKey}`,
            {
                method: "DELETE",
                headers: {
                    Authorization: `Basic ${encodedKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    customerKey,
                }),
            },
        );

        // TossPayments returns 200 on success, but we should handle errors gracefully
        if (!response.ok && response.status !== 404) {
            const errorData = await response.json().catch(() => ({}));
            console.error(
                "TossPayments billing key deletion failed:",
                errorData,
            );
            // Continue anyway - we still want to update our database
        }

        const cancelledAt = new Date().toISOString();
        const previousPlan = normalizePlanLike(
            subscription.plan || userData?.plan || "free",
            "free",
        );
        const effectiveUntil =
            resolveSubscriptionPeriodEnd({
                ...((userData || {}) as Record<string, unknown>),
                subscription,
            }) || undefined;
        const cancelledSubscription = sanitizeForFirestore({
            ...subscription,
            status: "cancelled",
            billingKey: null,
            customerKey: null,
            cancelledAt,
            isRecurring: false,
            nextBillingDate: effectiveUntil || subscription.nextBillingDate || null,
            updatedAt: cancelledAt,
        });

        await userRef.set(
            buildUserRootPatch({
                existingUser: (userData || {}) as Record<string, unknown>,
                subscription: cancelledSubscription as Record<string, unknown>,
                plan: previousPlan,
            }),
            { merge: true },
        );

        // Get user email for cancellation notification
        let userEmail: string | undefined;
        try {
            const userRecord = await admin.auth().getUser(userId);
            userEmail = userRecord.email || undefined;
        } catch (emailErr) {
            console.warn(
                "Could not get user email for cancellation:",
                emailErr,
            );
        }

        // Send cancellation email
        sendSubscriptionCancelledEmail(userId, {
            plan: previousPlan,
            cancelledAt,
            effectiveUntil,
            email: userEmail,
        }).catch((err) =>
            console.error("Failed to send cancellation email:", err),
        );

        return NextResponse.json({
            success: true,
            message:
                "다음 정기결제가 해지되었습니다. 만료일까지는 현재 플랜을 이용할 수 있습니다.",
            subscription: cancelledSubscription,
            effectiveUntil,
        });
    } catch (error: any) {
        console.error("Subscription cancellation error:", error);
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "구독 취소 중 오류가 발생했습니다",
            },
            { status: 500 },
        );
    }
}
