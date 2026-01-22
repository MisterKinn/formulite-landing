import { NextRequest, NextResponse } from "next/server";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { app } from "../../../../firebaseConfig";

/**
 * 결제 완료 후 빌링키 발급
 * POST /api/billing/issue-from-payment
 */
export async function POST(request: NextRequest) {
    try {
        const { paymentKey, customerKey, amount, orderName, billingCycle } =
            await request.json();

        if (!paymentKey || !customerKey) {
            return NextResponse.json(
                { success: false, error: "필수 파라미터 누락" },
                { status: 400 }
            );
        }

        // 토스페이먼츠 빌링키 발급 API
        const response = await fetch(
            `https://api.tosspayments.com/v1/payments/${paymentKey}/billing-key`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        process.env.TOSS_SECRET_KEY + ":"
                    ).toString("base64")}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    customerKey,
                }),
            }
        );

        const result = await response.json();

        if (!response.ok) {
            console.error("❌ 토스 API 오류:", result);
            return NextResponse.json(
                {
                    success: false,
                    error: result.message || `API 오류 (${response.status})`,
                    details: result,
                },
                { status: response.status }
            );
        }

        const { billingKey } = result;

        if (!billingKey) {
            return NextResponse.json(
                { success: false, error: "빌링키를 받지 못했습니다" },
                { status: 500 }
            );
        }

        // Firestore 저장
        const userId = customerKey.replace(/^(customer_|user_)/, "");

        const subscriptionData = {
            billingKey,
            customerKey,
            plan: amount >= 29900 ? "pro" : amount >= 19900 ? "plus" : "basic",
            status: "active",
            registeredAt: new Date().toISOString(),
            isRecurring: true,
            amount: amount || 0,
            orderName: orderName || "Nova AI 구독",
            billingCycle: billingCycle || "monthly",
            nextBillingDate: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
            ).toISOString(),
        };

        const db = getFirestore(app);
        await setDoc(
            doc(db, "users", userId, "subscription", "current"),
            subscriptionData,
            { merge: true }
        );

        return NextResponse.json({
            success: true,
            billingKey,
            subscription: subscriptionData,
        });
    } catch (error: any) {
        console.error("❌ 서버 오류:", error);
        return NextResponse.json(
            { success: false, error: error.message || "서버 오류" },
            { status: 500 }
        );
    }
}
