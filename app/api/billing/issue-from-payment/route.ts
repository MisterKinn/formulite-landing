import { NextRequest, NextResponse } from "next/server";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { getFirebaseApp } from "../../../../firebaseConfig";
import { getNextBillingDate } from "@/lib/subscription";
import { buildUserRootPatch, inferPlanFromAmount } from "@/lib/userData";

/**
 * 결제 완료 후 빌링키 발급
 * POST /api/billing/issue-from-payment
 */
export async function POST(request: NextRequest) {
    try {
        const {
            paymentKey,
            customerKey,
            userId: passedUserId,
            amount,
            orderName,
            billingCycle,
        } = await request.json();

        if (!paymentKey || !customerKey) {
            return NextResponse.json(
                { success: false, error: "필수 파라미터 누락" },
                { status: 400 },
            );
        }

        // 토스페이먼츠 빌링키 발급 API
        // 빌링키 발급에는 빌링 전용 시크릿 키 사용
        const billingSecretKey =
            process.env.TOSS_BILLING_SECRET_KEY || process.env.TOSS_SECRET_KEY;
        const response = await fetch(
            `https://api.tosspayments.com/v1/payments/${paymentKey}/billing-key`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        billingSecretKey + ":",
                    ).toString("base64")}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    customerKey,
                }),
            },
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
                { status: response.status },
            );
        }

        const { billingKey } = result;

        if (!billingKey) {
            return NextResponse.json(
                { success: false, error: "빌링키를 받지 못했습니다" },
                { status: 500 },
            );
        }

        // Firestore 저장
        const userId =
            passedUserId || extractUserIdFromCustomerKey(customerKey);
        if (!userId) {
            return NextResponse.json(
                { success: false, error: "userId를 확인할 수 없습니다" },
                { status: 400 },
            );
        }

        // Handle test billing cycle (100 won / 1 minute)
        const cycle = billingCycle || "monthly";
        const plan = inferPlanFromAmount(Number(amount || 0), cycle);

        const subscriptionData = {
            billingKey,
            customerKey,
            plan,
            status: "active",
            registeredAt: new Date().toISOString(),
            lastPaymentDate: new Date().toISOString(),
            isRecurring: true,
            amount: amount || 0,
            orderName: orderName || "Nova AI 구독",
            billingCycle: cycle,
            nextBillingDate: getNextBillingDate(cycle),
        };

        const db = getFirestore(getFirebaseApp());
        const userRef = doc(db, "users", userId);
        const existingUserDoc = await getDoc(userRef);
        const existingUser = existingUserDoc.exists()
            ? (existingUserDoc.data() as Record<string, unknown>)
            : {};

        await setDoc(
            userRef,
            buildUserRootPatch({
                existingUser,
                subscription: subscriptionData as unknown as Record<string, unknown>,
                plan: subscriptionData.plan,
                aiCallUsage: 0,
                usageResetAt: subscriptionData.lastPaymentDate,
            }),
            { merge: true },
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
            { status: 500 },
        );
    }
}

function extractUserIdFromCustomerKey(customerKey?: string): string | null {
    if (!customerKey) return null;
    if (customerKey.startsWith("user_")) {
        return customerKey.slice("user_".length) || null;
    }
    const customerMatch = customerKey.match(/^customer_(.+)_\d+$/);
    if (customerMatch?.[1]) {
        return customerMatch[1];
    }
    return null;
}
