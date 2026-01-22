import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { isRefundable, updatePaymentRecord } from "@/lib/paymentHistory";

/**
 * 환불 요청 API
 * POST /api/payments/refund
 *
 * Body: { userId, paymentKey, reason? }
 *
 * 7일 이내 결제만 환불 가능
 */
export async function POST(request: NextRequest) {
    try {
        const { userId, paymentKey, reason } = await request.json();

        if (!userId || !paymentKey) {
            return NextResponse.json(
                { success: false, error: "userId와 paymentKey가 필요합니다" },
                { status: 400 },
            );
        }

        const admin = getFirebaseAdmin();
        const db = admin.firestore();

        // Get payment record
        const paymentRef = db
            .collection("users")
            .doc(userId)
            .collection("payments")
            .doc(paymentKey);

        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            return NextResponse.json(
                { success: false, error: "결제 내역을 찾을 수 없습니다" },
                { status: 404 },
            );
        }

        const payment = paymentDoc.data()!;

        // Check if already refunded
        if (payment.status === "REFUNDED") {
            return NextResponse.json(
                { success: false, error: "이미 환불된 결제입니다" },
                { status: 400 },
            );
        }

        // Check if refundable (within 7 days)
        if (!isRefundable(payment.approvedAt)) {
            return NextResponse.json(
                { success: false, error: "환불 가능 기간(7일)이 지났습니다" },
                { status: 400 },
            );
        }

        // Request refund from TossPayments
        const secretKey = process.env.TOSS_SECRET_KEY!;
        const encodedKey = Buffer.from(secretKey + ":").toString("base64");

        const response = await fetch(
            `https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${encodedKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    cancelReason: reason || "고객 요청에 의한 환불",
                }),
            },
        );

        const result = await response.json();

        if (!response.ok) {
            console.error("TossPayments refund failed:", result);
            return NextResponse.json(
                {
                    success: false,
                    error: result.message || "환불 처리에 실패했습니다",
                },
                { status: response.status },
            );
        }

        // Update payment record
        await paymentRef.update({
            status: "REFUNDED",
            refundedAt: new Date().toISOString(),
            refundAmount: payment.amount,
            refundReason: reason || "고객 요청에 의한 환불",
            updatedAt: new Date().toISOString(),
        });

        // Update subscription status if this was the last payment
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        const subscription = userDoc.data()?.subscription;

        if (subscription?.lastPayment?.paymentKey === paymentKey) {
            // This was the most recent payment, downgrade to free
            await userRef.update({
                plan: "free",
                "subscription.status": "refunded",
                "subscription.plan": "free",
                "subscription.amount": 0,
                "subscription.isRecurring": false,
                "subscription.billingKey": null,
                "subscription.refundedAt": new Date().toISOString(),
            });
        }

        return NextResponse.json({
            success: true,
            message: "환불이 완료되었습니다",
            refundAmount: payment.amount,
        });
    } catch (error: any) {
        console.error("Refund error:", error);
        return NextResponse.json(
            { success: false, error: error?.message || "서버 오류" },
            { status: 500 },
        );
    }
}
