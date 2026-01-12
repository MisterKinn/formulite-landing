import { NextRequest, NextResponse } from "next/server";
import { processScheduledBilling } from "@/lib/scheduledBilling";

/**
 * 월간/연간 구독 자동 결제 API 엔드포인트
 *
 * 사용법:
 * 1. Vercel Cron: vercel.json에 cron job 설정
 * 2. 외부 스케줄러: 매일 이 엔드포인트 호출
 * 3. 수동 실행: 관리자가 직접 호출
 *
 * 보안: 프로덕션에서는 비밀 토큰 또는 Vercel Cron 전용 헤더로 보호 필요
 */
export async function POST(request: NextRequest) {
    try {
        // 보안 검증 (프로덕션에서 활성화)
        const authHeader = request.headers.get("authorization");
        const cronSecret = process.env.CRON_SECRET;

        if (process.env.NODE_ENV === "production") {
            // Vercel Cron Jobs의 경우 x-vercel-cron 헤더 확인
            const isVercelCron = request.headers.get("x-vercel-cron");

            if (
                !isVercelCron &&
                (!authHeader ||
                    !cronSecret ||
                    authHeader !== `Bearer ${cronSecret}`)
            ) {
                return NextResponse.json(
                    { error: "Unauthorized" },
                    { status: 401 }
                );
            }
        }

        console.log("🚀 Starting scheduled billing via API...");

        const results = await processScheduledBilling();

        const summary = {
            timestamp: new Date().toISOString(),
            totalProcessed: results.length,
            successful: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            totalAmount: results
                .filter((r) => r.success && r.amount)
                .reduce((sum, r) => sum + (r.amount || 0), 0),
        };

        console.log("📊 Billing summary:", summary);

        return NextResponse.json({
            success: true,
            message: "Scheduled billing completed",
            summary,
            results: results.map((r) => ({
                userId: r.userId,
                success: r.success,
                error: r.error || undefined,
                orderId: r.orderId || undefined,
            })),
        });
    } catch (error) {
        console.error("❌ Scheduled billing API error:", error);

        return NextResponse.json(
            {
                success: false,
                error: "Internal server error",
                message:
                    error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
    }
}

/**
 * 스케줄링 상태 조회 (GET)
 */
export async function GET(request: NextRequest) {
    try {
        // 간단한 상태 정보 반환
        const status = {
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            billingEnabled: !!process.env.TOSS_SECRET_KEY,
            cronSecret: !!process.env.CRON_SECRET,
        };

        return NextResponse.json({
            message: "Scheduled billing service is running",
            status,
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Service unavailable" },
            { status: 503 }
        );
    }
}
