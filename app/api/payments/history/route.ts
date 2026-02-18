import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { getPaymentHistory, isRefundable } from "@/lib/paymentHistory";

/**
 * Get user's payment history
 * GET /api/payments/history?userId={userId}
 */
export async function GET(request: NextRequest) {
    try {
        const userId = request.nextUrl.searchParams.get("userId");

        if (!userId) {
            return NextResponse.json(
                { success: false, error: "userId가 필요합니다" },
                { status: 400 },
            );
        }

        const payments = await getPaymentHistory(userId, 50);

        // Add refundable status to each payment
        const paymentsWithRefundable = payments.map((payment) => ({
            ...payment,
            refundable:
                payment.status === "DONE" && isRefundable(payment.approvedAt),
        }));

        return NextResponse.json({
            success: true,
            payments: paymentsWithRefundable,
        });
    } catch (error: any) {
        console.error("Payment history error:", error);
        return NextResponse.json(
            { success: false, error: error?.message || "서버 오류" },
            { status: 500 },
        );
    }
}
