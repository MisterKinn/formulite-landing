import { NextRequest, NextResponse } from "next/server";
import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
} from "firebase/firestore";
import { getFirebaseApp } from "@/firebaseConfig";
import { saveSubscription, getNextBillingDate } from "@/lib/subscription";

/**
 * 빌링키를 사용한 자동 결제 API
 * POST /api/billing/charge - 빌링키로 즉시 결제
 * PUT /api/billing/charge - userId로 사용자 조회 후 자동 결제
 *
 * POST Body: {
 *   billingKey: string,
 *   customerKey: string,
 *   amount: number,
 *   orderName: string
 * }
 */
export async function POST(request: NextRequest) {
    try {
        const { billingKey, customerKey, amount, orderName } =
            await request.json();

        if (!billingKey || !customerKey || !amount || !orderName) {
            return NextResponse.json(
                {
                    success: false,
                    error: "billingKey, customerKey, amount, orderName이 필요합니다",
                },
                { status: 400 },
            );
        }

        // 토스페이먼츠 자동 결제 API 호출
        const orderId = `first_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

        // TossPayments billing API: billingKey goes in the PATH
        // 빌링 결제에는 빌링 전용 시크릿 키 사용
        const billingSecretKey =
            process.env.TOSS_BILLING_SECRET_KEY || process.env.TOSS_SECRET_KEY;
        const response = await fetch(
            `https://api.tosspayments.com/v1/billing/${billingKey}`,
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
                    amount,
                    orderId,
                    orderName,
                }),
            },
        );

        const result = await response.json();

        if (!response.ok) {
            console.error("❌ 토스페이먼츠 결제 실패:", result);
            return NextResponse.json(
                {
                    success: false,
                    error:
                        result.message || `결제 API 오류 (${response.status})`,
                },
                { status: response.status },
            );
        }

        return NextResponse.json({
            success: true,
            orderId,
            amount: result.totalAmount,
            approvedAt: result.approvedAt,
            message: "결제가 완료되었습니다",
        });
    } catch (error) {
        console.error("❌ 결제 API 오류:", error);
        return NextResponse.json(
            {
                success: false,
                error: "내부 서버 오류가 발생했습니다",
                details:
                    error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
        );
    }
}

/**
 * 빌링키를 사용한 자동 결제 API
 * PUT /api/billing/charge
 *
 * Body: {
 *   userId: string,
 *   amount: number,
 *   orderName: string
 * }
 */
export async function PUT(request: NextRequest) {
    try {
        const { userId, amount, orderName } = await request.json();

        if (!userId || !amount || !orderName) {
            return NextResponse.json(
                {
                    success: false,
                    error: "userId, amount, orderName이 필요합니다",
                },
                { status: 400 },
            );
        }

        const db = getFirestore(getFirebaseApp());

        // Firestore에서 사용자 구독 정보 조회
        const userRef = collection(db, "users");
        const q = query(userRef, where("__name__", "==", userId));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return NextResponse.json(
                { success: false, error: "사용자를 찾을 수 없습니다" },
                { status: 404 },
            );
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();
        const subscription = userData.subscription;

        if (!subscription || !subscription.billingKey) {
            return NextResponse.json(
                { success: false, error: "등록된 빌링키가 없습니다" },
                { status: 400 },
            );
        }

        if (subscription.status !== "active") {
            return NextResponse.json(
                { success: false, error: "활성 상태가 아닌 구독입니다" },
                { status: 400 },
            );
        }

        // 토스페이먼츠 자동 결제 API 호출
        const orderId = `auto_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

        // TossPayments billing API: billingKey goes in the PATH
        // 빌링 결제에는 빌링 전용 시크릿 키 사용
        const billingSecretKey =
            process.env.TOSS_BILLING_SECRET_KEY || process.env.TOSS_SECRET_KEY;
        const response = await fetch(
            `https://api.tosspayments.com/v1/billing/${subscription.billingKey}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        billingSecretKey + ":",
                    ).toString("base64")}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    customerKey: subscription.customerKey,
                    amount,
                    orderId,
                    orderName,
                }),
            },
        );

        const result = await response.json();

        if (response.ok && result.status === "DONE") {
            // 결제 성공: 다음 결제일 업데이트
            const nextBillingDate = getNextBillingDate(
                subscription.billingCycle || "monthly",
            );

            await saveSubscription(userId, {
                ...subscription,
                nextBillingDate,
                lastPaymentDate: new Date().toISOString(),
                lastOrderId: orderId,
                failureCount: 0, // 성공 시 실패 카운트 리셋
            }, {
                resetUsageAt: new Date().toISOString(),
            });

            return NextResponse.json({
                success: true,
                orderId,
                amount,
                nextBillingDate,
                message: "자동 결제가 완료되었습니다",
            });
        } else {
            // 결제 실패
            console.error("자동 결제 실패:", result);

            // 실패 횟수 증가
            const failureCount = (subscription.failureCount || 0) + 1;
            let newStatus = subscription.status;

            // 3번 연속 실패 시 구독 일시정지
            if (failureCount >= 3) {
                newStatus = "suspended";
            }

            await saveSubscription(userId, {
                ...subscription,
                failureCount,
                status: newStatus,
                lastFailureDate: new Date().toISOString(),
                lastFailureReason: result.message || "결제 실패",
            });

            return NextResponse.json(
                {
                    success: false,
                    error: result.message || "결제 처리 실패",
                    failureCount,
                    suspended: newStatus === "suspended",
                },
                { status: 402 }, // Payment Required
            );
        }
    } catch (error) {
        console.error("자동 결제 API 오류:", error);

        return NextResponse.json(
            {
                success: false,
                error: "내부 서버 오류",
                details:
                    error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
        );
    }
}
