import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { savePaymentRecord } from "@/lib/paymentHistory";
import { getNextBillingDate } from "@/lib/subscription";
import {
    sendPaymentReceipt,
    sendPaymentFailureNotification,
} from "@/lib/email";

/**
 * 빌링키 발급 API
 * authKey와 customerKey를 받아서 토스페이먼츠에 빌링키 발급 요청
 */
export async function POST(request: NextRequest) {
    try {
        const {
            authKey,
            customerKey,
            userId: passedUserId,
            amount,
            orderName,
            billingCycle,
        } = await request.json();

        if (!authKey || !customerKey) {
            return NextResponse.json(
                { success: false, error: "authKey와 customerKey가 필요합니다" },
                { status: 400 },
            );
        }

        // 빌링키 발급에는 빌링 전용 시크릿 키 사용
        const secretKey =
            process.env.TOSS_BILLING_SECRET_KEY || process.env.TOSS_SECRET_KEY!;
        const encodedKey = Buffer.from(secretKey + ":").toString("base64");

        // 토스페이먼츠 빌링키 발급 API 호출
        const response = await fetch(
            `https://api.tosspayments.com/v1/billing/authorizations/${authKey}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${encodedKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ customerKey }),
            },
        );

        const result = await response.json();

        if (!response.ok) {
            console.error("❌ 토스페이먼츠 빌링키 발급 실패:", result);
            return NextResponse.json(
                {
                    success: false,
                    error:
                        result.message ||
                        `토스페이먼츠 API 오류 (${response.status})`,
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

        // Use passed userId or extract from customerKey as fallback
        const userId =
            passedUserId || extractUserIdFromCustomerKey(customerKey);

        if (!userId) {
            return NextResponse.json(
                {
                    success: false,
                    error: "userId가 필요합니다",
                },
                { status: 400 },
            );
        }

        // 구독 정보가 있으면 활성 구독으로 설정
        // Determine plan based on amount and billing cycle
        let plan: "free" | "basic" | "plus" | "pro" | "test" = "free";
        if (billingCycle === "test") {
            plan = "test";
        } else if (amount) {
            if (amount >= 29900) {
                plan = "pro";
            } else if (amount >= 19900) {
                plan = "plus";
            } else if (amount >= 9900) {
                plan = "basic";
            }
        }

        // ═══════════════════════════════════════
        // 💰 첫 결제 실행 (빌링키로 즉시 결제)
        // ═══════════════════════════════════════
        let firstPaymentResult = null;
        if (amount && amount > 0) {
            const orderId = `first_${userId}_${Date.now()}`;

            try {
                const paymentResponse = await fetch(
                    "https://api.tosspayments.com/v1/billing/" + billingKey,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Basic ${encodedKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            customerKey,
                            amount,
                            orderId,
                            orderName: orderName || "Nova AI 구독",
                        }),
                    },
                );

                const paymentResult = await paymentResponse.json();

                if (!paymentResponse.ok) {
                    console.error("❌ 첫 결제 실패:", paymentResult);
                    return NextResponse.json(
                        {
                            success: false,
                            error:
                                paymentResult.message ||
                                "첫 결제에 실패했습니다",
                            billingKeyIssued: true, // 빌링키는 발급됨
                        },
                        { status: 400 },
                    );
                }

                firstPaymentResult = {
                    paymentKey: paymentResult.paymentKey || null,
                    orderId: paymentResult.orderId || null,
                    amount: paymentResult.totalAmount || 0,
                    approvedAt: paymentResult.approvedAt || null,
                    method: paymentResult.method || null,
                    card: paymentResult.card
                        ? {
                              company: paymentResult.card.company || null,
                              number: paymentResult.card.number || null,
                          }
                        : null,
                };

                // Save payment to history
                await savePaymentRecord(userId, {
                    paymentKey: firstPaymentResult.paymentKey,
                    orderId: firstPaymentResult.orderId,
                    amount: firstPaymentResult.amount,
                    orderName: orderName || "Nova AI 구독",
                    method: firstPaymentResult.method || "카드",
                    status: "DONE",
                    approvedAt: firstPaymentResult.approvedAt,
                    card: firstPaymentResult.card,
                });

                // Get user email for receipt
                let userEmail: string | undefined;
                try {
                    const admin = getFirebaseAdmin();
                    const userRecord = await admin.auth().getUser(userId);
                    userEmail = userRecord.email || undefined;
                } catch (emailErr) {
                    console.warn(
                        "Could not get user email for receipt:",
                        emailErr,
                    );
                }

                // Send payment receipt email
                sendPaymentReceipt(userId, {
                    orderId: firstPaymentResult.orderId,
                    amount: firstPaymentResult.amount,
                    method: firstPaymentResult.method || "카드",
                    approvedAt: firstPaymentResult.approvedAt,
                    plan,
                    orderName: orderName || "Nova AI 구독",
                    email: userEmail,
                }).catch((err) =>
                    console.error("Failed to send receipt email:", err),
                );
            } catch (paymentError) {
                console.error("❌ 결제 요청 중 오류:", paymentError);
                return NextResponse.json(
                    {
                        success: false,
                        error: "결제 처리 중 오류가 발생했습니다",
                        billingKeyIssued: true,
                    },
                    { status: 500 },
                );
            }
        }

        const subscriptionData = {
            billingKey,
            customerKey,
            plan,
            status: firstPaymentResult ? "active" : "billing_registered",
            registeredAt: new Date().toISOString(),
            isRecurring: !!amount,
            amount: amount || 0,
            orderName: orderName || "Nova AI 구독",
            billingCycle: billingCycle || "monthly",
            nextBillingDate: firstPaymentResult
                ? getNextBillingDate(billingCycle || "monthly")
                : null,
            lastPayment: firstPaymentResult || null,
        };

        await saveBillingKeyToFirestore(userId, subscriptionData);

        return NextResponse.json({
            success: true,
            billingKey: billingKey,
            subscription: subscriptionData,
            payment: firstPaymentResult,
            message: firstPaymentResult
                ? "결제가 완료되고 구독이 시작되었습니다"
                : "카드가 성공적으로 등록되었습니다",
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "내부 서버 오류가 발생했습니다",
                details: error?.stack || "Unknown error",
            },
            { status: 500 },
        );
    }
}

/**
 * customerKey에서 userId 추출
 * 형식: "customer_{userId}_{timestamp}" 또는 "user_{userId}"
 */
function extractUserIdFromCustomerKey(customerKey: string): string | null {
    try {
        const parts = customerKey.split("_");

        // "customer_{userId}_{timestamp}" 형식
        if (parts.length >= 3 && parts[0] === "customer") {
            return parts[1]; // userId 부분
        }

        // "user_{userId}" 형식
        if (parts.length >= 2 && parts[0] === "user") {
            return parts[1]; // userId 부분
        }

        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Firestore에 빌링키 정보 저장
 */
async function saveBillingKeyToFirestore(
    userId: string,
    subscriptionData: any,
) {
    try {
        const admin = getFirebaseAdmin();
        const db = admin.firestore();

        // Firestore document ID에 사용할 수 없는 문자 처리
        // userId가 naver:xxx 형식일 수 있음
        const safeUserId = userId;

        const userRef = db.collection("users").doc(safeUserId);

        // 기존 사용자 데이터 조회
        const userDoc = await userRef.get();
        const existingData = userDoc.exists ? userDoc.data() || {} : {};

        // subscription 정보 업데이트
        await userRef.set(
            {
                ...existingData,
                plan: subscriptionData.plan,
                subscription: {
                    ...(existingData.subscription || {}),
                    ...subscriptionData,
                },
                updatedAt: new Date().toISOString(),
            },
            { merge: true },
        );
    } catch (error: any) {
        throw new Error(
            `데이터베이스 저장에 실패했습니다: ${error?.message || "Unknown error"}`,
        );
    }
}
