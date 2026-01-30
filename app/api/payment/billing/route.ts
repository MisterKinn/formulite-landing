import { NextRequest, NextResponse } from "next/server";
import { saveSubscription, getNextBillingDate } from "@/lib/subscription";
import {
    parseTossError,
    validatePaymentAmount,
    logPaymentError,
    retryPaymentOperation,
} from "@/lib/paymentErrors";

// Save billing key after successful billing auth
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { authKey, customerKey, userId, plan, amount } = body;

        if (!authKey || !customerKey || !userId || !plan) {
            return NextResponse.json(
                { error: "필수 정보가 누락되었습니다" },
                { status: 400 },
            );
        }

        // Validate amount if provided
        if (amount) {
            const validation = validatePaymentAmount(amount);
            if (!validation.valid) {
                return NextResponse.json(
                    { error: validation.error },
                    { status: 400 },
                );
            }
        }

        // Save to Firebase
        const result = await saveSubscription(userId, {
            plan: plan,
            billingKey: authKey,
            customerKey: customerKey,
            startDate: new Date().toISOString(),
            nextBillingDate: getNextBillingDate(),
            status: "active",
            amount: amount || 0,
        });

        if (!result.success) {
            logPaymentError(
                {
                    code: "DB_ERROR",
                    message: "Failed to save subscription",
                    userMessage: "구독 정보 저장에 실패했습니다",
                },
                { userId, plan },
            );
            return NextResponse.json(
                { error: "구독 정보 저장에 실패했습니다" },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            message: "Subscription activated",
        });
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "알 수 없는 오류";
        logPaymentError(
            {
                code: "INTERNAL_ERROR",
                message: errorMessage,
                userMessage: "구독 처리 중 오류가 발생했습니다",
            },
            { context: "billing_post" },
        );
        return NextResponse.json(
            { error: "구독 처리 중 오류가 발생했습니다" },
            { status: 500 },
        );
    }
}

// Charge monthly billing (called by scheduled function)
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { billingKey, customerKey, amount, orderId, orderName } = body;

        if (!billingKey || !customerKey || !amount) {
            return NextResponse.json(
                { error: "필수 정보가 누락되었습니다" },
                { status: 400 },
            );
        }

        // Validate amount
        const validation = validatePaymentAmount(amount);
        if (!validation.valid) {
            return NextResponse.json(
                { error: validation.error },
                { status: 400 },
            );
        }

        // 빌링 결제에는 빌링 전용 시크릿 키 사용
        const secretKey =
            process.env.TOSS_BILLING_SECRET_KEY || process.env.TOSS_SECRET_KEY;
        if (!secretKey) {
            return NextResponse.json(
                { error: "Server configuration error" },
                { status: 500 },
            );
        }

        // Call Toss Payments billing API
        const response = await fetch(
            "https://api.tosspayments.com/v1/billing/" + billingKey,
            {
                method: "POST",
                headers: {
                    Authorization:
                        "Basic " +
                        Buffer.from(secretKey + ":").toString("base64"),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    customerKey,
                    amount,
                    orderId: orderId || `order_${Date.now()}`,
                    orderName: orderName || "Nova AI 월간 구독",
                }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            const paymentError = parseTossError(data);
            logPaymentError(paymentError, {
                billingKey,
                customerKey,
                amount,
                context: "monthly_billing_charge",
            });
            return NextResponse.json(
                {
                    error: paymentError.userMessage,
                    code: paymentError.code,
                },
                { status: response.status },
            );
        }

        return NextResponse.json({
            success: true,
            data,
        });
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "알 수 없는 오류";
        logPaymentError(
            {
                code: "INTERNAL_ERROR",
                message: errorMessage,
                userMessage: "정기 결제 처리 중 오류가 발생했습니다",
            },
            { context: "billing_put" },
        );
        return NextResponse.json(
            { error: "정기 결제 처리 중 오류가 발생했습니다" },
            { status: 500 },
        );
    }
}
