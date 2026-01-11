import { NextRequest, NextResponse } from "next/server";
import {
    parseTossError,
    validatePaymentAmount,
    logPaymentError,
} from "@/lib/paymentErrors";

export async function POST(request: NextRequest) {
    try {
        const { paymentKey, orderId, amount } = await request.json();

        // 필수 파라미터 검증
        if (!paymentKey || !orderId || !amount) {
            return NextResponse.json(
                { error: "필수 파라미터가 누락되었습니다" },
                { status: 400 }
            );
        }

        // 금액 검증
        const amountValidation = validatePaymentAmount(amount);
        if (!amountValidation.valid) {
            return NextResponse.json(
                { error: amountValidation.error },
                { status: 400 }
            );
        }

        // 시크릿 키 확인
        const secretKey = process.env.TOSS_SECRET_KEY;
        if (!secretKey) {
            console.error("TOSS_SECRET_KEY is not set");
            return NextResponse.json(
                { error: "Server configuration error" },
                { status: 500 }
            );
        }

        // Base64 인코딩 (Basic 인증)
        const basicAuth = Buffer.from(`${secretKey}:`).toString("base64");

        // 토스페이먼츠 API로 결제 승인 요청
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
            }
        );

        const data = await response.json();

        if (!response.ok) {
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
                { status: response.status }
            );
        }

        // 결제 성공
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
            { context: "payment_confirmation_catch" }
        );
        return NextResponse.json(
            { error: "결제 처리 중 오류가 발생했습니다" },
            { status: 500 }
        );
    }
}
