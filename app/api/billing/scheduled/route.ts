import { NextRequest, NextResponse } from "next/server";
import { processScheduledBilling } from "@/lib/scheduledBilling";
import { Resend } from "resend";

// Initialize Resend for email notifications
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Send billing report email to admin
 */
async function sendBillingReport(summary: {
    timestamp: string;
    totalProcessed: number;
    successful: number;
    failed: number;
    totalAmount: number;
    failedUsers?: { userId: string; error: string }[];
}) {
    if (!resend || !process.env.EMAIL_FROM) return;

    const hasFailures = summary.failed > 0;
    const subject = hasFailures
        ? `⚠️ [Nova AI] 빌링 오류 발생 - ${summary.failed}건 실패`
        : `✅ [Nova AI] 빌링 완료 - ${summary.successful}건 성공`;

    const failedList = summary.failedUsers
        ?.map((f) => `• ${f.userId}: ${f.error}`)
        .join("\n") || "없음";

    const html = `
        <h2>Nova AI 자동 결제 리포트</h2>
        <p><strong>시간:</strong> ${summary.timestamp}</p>
        <hr/>
        <h3>요약</h3>
        <ul>
            <li>총 처리: ${summary.totalProcessed}건</li>
            <li>성공: ${summary.successful}건</li>
            <li>실패: ${summary.failed}건</li>
            <li>총 결제금액: ${summary.totalAmount.toLocaleString()}원</li>
        </ul>
        ${hasFailures ? `
            <h3 style="color: red;">실패 내역</h3>
            <pre>${failedList}</pre>
        ` : ""}
    `;

    try {
        await resend.emails.send({
            from: process.env.EMAIL_FROM,
            to: "kinn@kinn.kr",
            subject,
            html,
        });
    } catch (err) {
        console.error("Failed to send billing report email:", err);
    }
}

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
                    { status: 401 },
                );
            }
        }

        const results = await processScheduledBilling();

        const failedUsers = results
            .filter((r) => !r.success)
            .map((r) => ({ userId: r.userId, error: r.error || "Unknown error" }));

        const summary = {
            timestamp: new Date().toISOString(),
            totalProcessed: results.length,
            successful: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            totalAmount: results
                .filter((r) => r.success && r.amount)
                .reduce((sum, r) => sum + (r.amount || 0), 0),
            failedUsers,
        };

        // Send email report (always for failures, optionally for success)
        if (summary.totalProcessed > 0) {
            await sendBillingReport(summary);
        }

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

        // Send critical error notification
        if (resend && process.env.EMAIL_FROM) {
            try {
                await resend.emails.send({
                    from: process.env.EMAIL_FROM,
                    to: "kinn@kinn.kr",
                    subject: "🚨 [Nova AI] 빌링 크론 작업 실패!",
                    html: `
                        <h2 style="color: red;">빌링 크론 작업이 실패했습니다!</h2>
                        <p><strong>시간:</strong> ${new Date().toISOString()}</p>
                        <p><strong>오류:</strong></p>
                        <pre>${error instanceof Error ? error.message : "Unknown error"}</pre>
                        <pre>${error instanceof Error ? error.stack : ""}</pre>
                        <p>즉시 확인이 필요합니다.</p>
                    `,
                });
            } catch (emailErr) {
                console.error("Failed to send error notification:", emailErr);
            }
        }

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
            { status: 503 },
        );
    }
}
