import { NextRequest, NextResponse } from "next/server";
import { billUserImmediately } from "@/lib/scheduledBilling";

/**
 * 특정 사용자 즉시 결제 API (관리자 전용)
 * POST /api/billing/user/[userId]
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> },
) {
    try {
        // 간단한 관리자 인증 (프로덕션에서는 더 강력한 인증 필요)
        const authHeader = request.headers.get("authorization");
        const adminSecret = process.env.ADMIN_SECRET;

        if (process.env.NODE_ENV === "production") {
            if (
                !authHeader ||
                !adminSecret ||
                authHeader !== `Bearer ${adminSecret}`
            ) {
                return NextResponse.json(
                    { error: "Admin access required" },
                    { status: 401 },
                );
            }
        }

        const { userId } = await params;

        if (!userId) {
            return NextResponse.json(
                { error: "User ID is required" },
                { status: 400 },
            );
        }

        const result = await billUserImmediately(userId);

        if (result.success) {
            return NextResponse.json({
                success: true,
                message: "User billed successfully",
                result: {
                    userId: result.userId,
                    amount: result.amount,
                    orderId: result.orderId,
                },
            });
        } else {
            return NextResponse.json(
                {
                    success: false,
                    message: "Billing failed",
                    error: result.error,
                },
                { status: 422 },
            );
        }
    } catch (error) {
        console.error("❌ Admin billing error:", error);

        return NextResponse.json(
            {
                success: false,
                error: "Internal server error",
                message:
                    error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
        );
    }
}
