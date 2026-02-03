import { NextRequest, NextResponse } from "next/server";
import {
    parseTossError,
    validatePaymentAmount,
    logPaymentError,
} from "@/lib/paymentErrors";

/**
 * Toss Payments Confirm API
 * - idempotent 처리
 * - S008 / ALREADY_PROCESSED_PAYMENT 정상 처리
 */
export async function POST(request: NextRequest) {
    try {
        const { paymentKey, orderId, amount } = await request.json();

        /* ------------------ 1. 기본 검증 ------------------ */
        if (!paymentKey || !orderId || !amount) {
            return NextResponse.json(
                { error: "필수 파라미터가 누락되었습니다" },
                { status: 400 },
            );
        }

        const amountValidation = validatePaymentAmount(amount);
        if (!amountValidation.valid) {
            return NextResponse.json(
                { error: amountValidation.error },
                { status: 400 },
            );
        }

        // orderId 패턴으로 빌링 결제인지 단건 결제인지 구분
        // billing_xxx → 빌링용 시크릿 키 사용
        // order_xxx → 단건용 시크릿 키 사용
        const isBillingPayment = orderId?.startsWith("billing");
        const secretKey = isBillingPayment
            ? process.env.TOSS_BILLING_SECRET_KEY || process.env.TOSS_SECRET_KEY
            : process.env.TOSS_SECRET_KEY;

        if (!secretKey) {
            console.error("TOSS_SECRET_KEY is not set");
            return NextResponse.json(
                { error: "Server configuration error" },
                { status: 500 },
            );
        }

        const basicAuth = Buffer.from(`${secretKey}:`).toString("base64");

        /* ------------------ 2. Toss confirm 요청 ------------------ */
        const response = await fetch(
            "https://api.tosspayments.com/v1/payments/confirm",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Basic ${basicAuth}`,
                },
                body: JSON.stringify({
                    paymentKey,
                    orderId,
                    amount,
                }),
            },
        );

        const data = await response.json();

        /* ------------------ 3. 실패 처리 (중요) ------------------ */
        if (!response.ok) {
            /**
             * ✅ 이미 처리된 결제 (S008 / ALREADY_PROCESSED)
             * → 실패가 아니라 "이미 성공"으로 간주
             */
            if (
                data?.code === "ALREADY_PROCESSED_PAYMENT" ||
                data?.message?.includes("기존 요청을 처리중")
            ) {
                return NextResponse.json({
                    success: true,
                    data: {
                        paymentKey,
                        orderId,
                        amount,
                        alreadyProcessed: true,
                    },
                });
            }

            const paymentError = parseTossError(data);

            logPaymentError(paymentError, {
                paymentKey,
                orderId,
                amount,
                context: "payment_confirmation",
            });

            return NextResponse.json(
                {
                    error: paymentError.userMessage,
                    code: paymentError.code,
                },
                { status: response.status },
            );
        }

        /* ------------------ 4. 정상 성공 ------------------ */
        // When available, update user subscription immediately based on customerKey
        try {
            const customerKey = data?.customerKey;
            const totalAmount = Number(data?.totalAmount ?? data?.amount ?? 0);
            if (customerKey) {
                const userId = (customerKey || "").split("_")[1] || null;
                if (userId) {
                    // map amount to plan
                    let plan: "plus" | "pro" | null = null;
                    if (totalAmount >= 49900) {
                        plan = "pro";
                    } else if (totalAmount >= 19900) {
                        plan = "plus";
                    }
                    if (plan) {
                        const { saveSubscription } =
                            await import("@/lib/subscription");
                        await saveSubscription(userId, {
                            plan: plan as any,
                            amount: totalAmount,
                            startDate: new Date().toISOString(),
                            status: "active",
                            customerKey,
                            isRecurring: false, // confirmed as one-time via payment.confirm
                        });
                    }
                }
            }
        } catch (err) {
            console.error("Failed to update subscription after confirm:", err);
        }

        return NextResponse.json({
            success: true,
            data,
        });
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "알 수 없는 오류가 발생했습니다";

        logPaymentError(
            {
                code: "INTERNAL_ERROR",
                message: errorMessage,
                userMessage: "결제 처리 중 오류가 발생했습니다",
            },
            { context: "payment_confirmation_catch" },
        );

        return NextResponse.json(
            { error: "결제 처리 중 오류가 발생했습니다" },
            { status: 500 },
        );
    }
}
