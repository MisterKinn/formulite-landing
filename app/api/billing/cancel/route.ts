import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { sendSubscriptionCancelledEmail } from "@/lib/email";

/**
 * 구독 취소 API
 * POST /api/billing/cancel
 *
 * TossPayments에서 빌링키를 삭제하고 Firestore에서 구독 상태를 업데이트합니다.
 */
export async function POST(request: NextRequest) {
    try {
        const { userId } = await request.json();

        if (!userId) {
            return NextResponse.json(
                { success: false, error: "userId가 필요합니다" },
                { status: 400 },
            );
        }

        const admin = getFirebaseAdmin();
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

        // Update Firestore - mark subscription as cancelled and remove billing key
        const cancelledAt = new Date().toISOString();
        await userRef.update({
            "subscription.status": "cancelled",
            "subscription.billingKey": null,
            "subscription.cancelledAt": cancelledAt,
            "subscription.isRecurring": false,
        });

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
            plan: subscription.plan || "unknown",
            cancelledAt,
            effectiveUntil: subscription.nextBillingDate || null,
            email: userEmail,
        }).catch((err) =>
            console.error("Failed to send cancellation email:", err),
        );

        return NextResponse.json({
            success: true,
            message:
                "구독이 취소되었습니다. 다음 결제일까지 서비스를 이용할 수 있습니다.",
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
