/**
 * 월간/연간 구독 자동 결제 스케줄러
 * 매일 실행되어 결제 예정일이 지난 구독들을 자동으로 결제 처리합니다.
 * Vercel Cron Jobs, AWS Lambda, 또는 Google Cloud Functions으로 실행 가능합니다.
 */

import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
    doc,
    updateDoc,
} from "firebase/firestore";
import { app } from "../firebaseConfig";
import { saveSubscription, getNextBillingDate } from "./subscription";

const db = getFirestore(app);

interface BillingResult {
    userId: string;
    success: boolean;
    error?: string;
    amount?: number;
    orderId?: string;
}

/**
 * 토스페이먼츠 빌링 API를 사용해 자동 결제를 실행합니다.
 */
async function chargeBillingKey(
    billingKey: string,
    customerKey: string,
    amount: number,
    orderName: string
): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
        const orderId = `recurring_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

        const response = await fetch(
            "https://api.tosspayments.com/v1/billing/pay",
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        process.env.TOSS_SECRET_KEY + ":"
                    ).toString("base64")}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    billingKey,
                    customerKey,
                    amount,
                    orderId,
                    orderName,
                }),
            }
        );

        const result = await response.json();

        if (response.ok && result.status === "DONE") {
            return { success: true, orderId };
        } else {
            console.error("Billing charge failed:", result);
            return {
                success: false,
                error: result.message || `HTTP ${response.status}`,
            };
        }
    } catch (error) {
        console.error("Billing charge error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * 결제 예정일이 지난 모든 활성 구독을 처리합니다.
 */
export async function processScheduledBilling(): Promise<BillingResult[]> {
    console.log("🔄 Starting scheduled billing process...");

    try {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

        // 활성 구독 중 결제일이 지난 것들을 조회
        const usersRef = collection(db, "users");
        const q = query(
            usersRef,
            where("subscription.status", "==", "active"),
            where("subscription.isRecurring", "==", true),
            where("subscription.nextBillingDate", "<=", todayStr)
        );

        const snapshot = await getDocs(q);
        const results: BillingResult[] = [];

        console.log(
            `📋 Found ${snapshot.docs.length} subscriptions to process`
        );

        for (const userDoc of snapshot.docs) {
            const userId = userDoc.id;
            const userData = userDoc.data();
            const subscription = userData.subscription;

            // 필수 데이터 검증
            if (
                !subscription.billingKey ||
                !subscription.customerKey ||
                !subscription.amount
            ) {
                console.log(`⚠️ Skipping user ${userId}: Missing billing data`);
                results.push({
                    userId,
                    success: false,
                    error: "Missing billing data (billingKey, customerKey, or amount)",
                });
                continue;
            }

            console.log(`💳 Processing billing for user ${userId}...`);
            console.log(`   - 빌링키: ${subscription.billingKey}`);
            console.log(`   - 금액: ${subscription.amount}원`);
            console.log(`   - 플랜: ${subscription.plan}`);
            console.log(
                `   - 결제주기: ${subscription.billingCycle || "monthly"}`
            );

            // 토스페이먼츠 자동 결제 실행
            const billingResult = await chargeBillingKey(
                subscription.billingKey,
                subscription.customerKey,
                subscription.amount,
                `Nova AI ${subscription.plan} 요금제 (${
                    subscription.billingCycle === "yearly" ? "연간" : "월간"
                } 구독)`
            );

            if (billingResult.success) {
                // 결제 성공: 다음 결제일 업데이트
                const nextBillingDate = getNextBillingDate(
                    subscription.billingCycle || "monthly"
                );

                await saveSubscription(userId, {
                    ...subscription,
                    nextBillingDate,
                    lastPaymentDate: new Date().toISOString(),
                    lastOrderId: billingResult.orderId,
                });

                console.log(
                    `✅ Billing successful for user ${userId}, next billing: ${nextBillingDate}`
                );

                results.push({
                    userId,
                    success: true,
                    amount: subscription.amount,
                    orderId: billingResult.orderId,
                });

                // TODO: 성공 알림 이메일 발송
                // await sendPaymentReceipt(userId, { ... });
            } else {
                // 결제 실패: 재시도 로직 또는 구독 일시정지
                console.error(
                    `❌ Billing failed for user ${userId}:`,
                    billingResult.error
                );

                // 실패 횟수 증가 (선택사항)
                const failureCount = (subscription.failureCount || 0) + 1;
                let newStatus = subscription.status;

                // 3번 연속 실패 시 구독 일시정지 (정책에 따라 조정 가능)
                if (failureCount >= 3) {
                    newStatus = "suspended";
                    console.log(
                        `🚫 Subscription suspended for user ${userId} after ${failureCount} failures`
                    );
                }

                await saveSubscription(userId, {
                    ...subscription,
                    failureCount,
                    status: newStatus,
                    lastFailureDate: new Date().toISOString(),
                    lastFailureReason: billingResult.error,
                });

                results.push({
                    userId,
                    success: false,
                    error: billingResult.error,
                });

                // TODO: 실패 알림 이메일 발송
                // await sendPaymentFailureNotification(userId, { ... });
            }

            // API 호출 간 짧은 딜레이 (선택사항)
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        console.log(
            `🏁 Scheduled billing completed. Processed: ${
                results.length
            }, Successful: ${results.filter((r) => r.success).length}`
        );

        return results;
    } catch (error) {
        console.error("❌ Error in processScheduledBilling:", error);
        throw error;
    }
}

/**
 * 특정 사용자의 구독을 즉시 결제합니다. (관리자 기능 또는 테스트용)
 */
export async function billUserImmediately(
    userId: string
): Promise<BillingResult> {
    try {
        const userRef = doc(db, "users", userId);
        const userDoc = await (
            await import("firebase/firestore")
        ).getDoc(userRef);

        if (!userDoc.exists()) {
            return { userId, success: false, error: "User not found" };
        }

        const subscription = userDoc.data().subscription;

        if (!subscription?.billingKey) {
            return { userId, success: false, error: "No billing key found" };
        }

        if (subscription.status !== "active" || !subscription.isRecurring) {
            return {
                userId,
                success: false,
                error: "Subscription not active or not recurring",
            };
        }

        console.log(`🔑 즉시 결제 실행 - 사용자: ${userId}`);
        console.log(`   - 빌링키: ${subscription.billingKey}`);
        console.log(`   - 금액: ${subscription.amount}원`);

        const billingResult = await chargeBillingKey(
            subscription.billingKey,
            subscription.customerKey,
            subscription.amount,
            `Nova AI ${subscription.plan} 요금제 (즉시 결제)`
        );

        if (billingResult.success) {
            const nextBillingDate = getNextBillingDate(
                subscription.billingCycle || "monthly"
            );

            await saveSubscription(userId, {
                ...subscription,
                nextBillingDate,
                lastPaymentDate: new Date().toISOString(),
                lastOrderId: billingResult.orderId,
            });
        }

        return {
            userId,
            success: billingResult.success,
            error: billingResult.error,
            amount: subscription.amount,
            orderId: billingResult.orderId,
        };
    } catch (error) {
        return {
            userId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
