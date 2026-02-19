/**
 * 월간/연간 구독 자동 결제 스케줄러
 * 매일 실행되어 결제 예정일이 지난 구독들을 자동으로 결제 처리합니다.
 * Vercel Cron Jobs, AWS Lambda, 또는 Google Cloud Functions으로 실행 가능합니다.
 */

import getFirebaseAdmin from "./firebaseAdmin";
import { getNextBillingDate } from "./subscription";
import { sendPaymentReceipt, sendPaymentFailureNotification } from "./email";

// Use Admin SDK for server-side operations
const getAdminDb = () => getFirebaseAdmin().firestore();

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
    orderName: string,
): Promise<{
    success: boolean;
    orderId?: string;
    paymentKey?: string;
    approvedAt?: string;
    method?: string;
    card?: { company: string | null; number: string | null } | null;
    error?: string;
}> {
    try {
        const orderId = `recurring_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

        // TossPayments billing API: billingKey goes in the PATH, not the body
        // 빌링 결제에는 빌링 전용 시크릿 키 사용
        const secretKey =
            process.env.TOSS_BILLING_SECRET_KEY || process.env.TOSS_SECRET_KEY;
        const response = await fetch(
            `https://api.tosspayments.com/v1/billing/${billingKey}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        secretKey + ":",
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

        if (response.ok && result.status === "DONE") {
            return {
                success: true,
                orderId,
                paymentKey: result.paymentKey,
                approvedAt: result.approvedAt,
                method: result.method,
                card: result.card
                    ? {
                          company: result.card.company || null,
                          number: result.card.number || null,
                      }
                    : null,
            };
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
        const db = getAdminDb();
        const now = new Date();
        const nowStr = now.toISOString(); // Full ISO timestamp for test billing

        // 활성 구독만 조회 (Admin SDK 사용)
        const snapshot = await db
            .collection("users")
            .where("subscription.status", "==", "active")
            .get();

        const results: BillingResult[] = [];

        // 디버깅: 모든 활성 구독 정보 출력
        console.log(
            `🔍 Checking ${snapshot.docs.length} active subscriptions...`,
        );
        snapshot.docs.forEach((doc, idx) => {
            const sub = doc.data().subscription;
            console.log(`   [${idx + 1}] User: ${doc.id}`);
            console.log(
                `       isRecurring: ${sub?.isRecurring} (type: ${typeof sub?.isRecurring})`,
            );
            console.log(`       nextBillingDate: ${sub?.nextBillingDate}`);
            console.log(`       now: ${nowStr}`);
            console.log(
                `       shouldProcess: ${sub?.isRecurring === true && sub?.nextBillingDate && sub.nextBillingDate <= nowStr}`,
            );
        });

        // 필터링: isRecurring=true 이고 nextBillingDate <= now인 것만 처리
        const eligibleDocs = snapshot.docs.filter((doc) => {
            const sub = doc.data().subscription;
            return (
                sub?.isRecurring === true &&
                sub?.nextBillingDate &&
                sub.nextBillingDate <= nowStr
            );
        });

        console.log(
            `📋 Found ${eligibleDocs.length} subscriptions to process (out of ${snapshot.docs.length} active)`,
        );

        for (const userDoc of eligibleDocs) {
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
                `   - 결제주기: ${subscription.billingCycle || "monthly"}`,
            );

            // 토스페이먼츠 자동 결제 실행
            const cycleLabel =
                subscription.billingCycle === "yearly"
                    ? "연간"
                    : subscription.billingCycle === "test"
                      ? "1분마다 100원"
                      : "월간";

            const billingResult = await chargeBillingKey(
                subscription.billingKey,
                subscription.customerKey,
                subscription.amount,
                subscription.billingCycle === "test"
                    ? "테스트 요금제 (1분마다 100원)"
                    : `Nova AI ${subscription.plan} 요금제 (${cycleLabel} 구독)`,
            );

            if (billingResult.success) {
                // 결제 성공: 다음 결제일 업데이트 (Admin SDK 사용)
                const nextBillingDate = getNextBillingDate(
                    subscription.billingCycle || "monthly",
                );

                // Update subscription using Admin SDK
                await db.collection("users").doc(userId).update({
                    "subscription.nextBillingDate": nextBillingDate,
                    "subscription.lastPaymentDate": new Date().toISOString(),
                    "subscription.lastOrderId": billingResult.orderId,
                    "subscription.failureCount": 0,
                    "subscription.lastFailureReason": null,
                    aiCallUsage: 0,
                    usageResetAt:
                        billingResult.approvedAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });

                // Save payment to history using Admin SDK
                const orderName = `Nova AI ${subscription.plan} 요금제 (${cycleLabel} 구독)`;

                await db
                    .collection("users")
                    .doc(userId)
                    .collection("payments")
                    .doc(billingResult.paymentKey!)
                    .set({
                        paymentKey: billingResult.paymentKey,
                        orderId: billingResult.orderId,
                        amount: subscription.amount,
                        orderName,
                        method: billingResult.method || "카드",
                        status: "DONE",
                        approvedAt: billingResult.approvedAt,
                        card: billingResult.card || null,
                        createdAt: new Date().toISOString(),
                    });

                console.log(
                    `✅ Billing successful for user ${userId}, next billing: ${nextBillingDate}`,
                );

                results.push({
                    userId,
                    success: true,
                    amount: subscription.amount,
                    orderId: billingResult.orderId,
                });

                // 성공 알림 이메일 발송
                sendPaymentReceipt(userId, {
                    orderId: billingResult.orderId!,
                    amount: subscription.amount,
                    method: billingResult.method || "카드",
                    approvedAt:
                        billingResult.approvedAt || new Date().toISOString(),
                    plan: subscription.plan,
                    orderName,
                }).catch((err) =>
                    console.error(
                        `Failed to send receipt email for user ${userId}:`,
                        err,
                    ),
                );
            } else {
                // 결제 실패: 재시도 로직
                console.error(
                    `❌ Billing failed for user ${userId}:`,
                    billingResult.error,
                );

                // 실패 횟수 증가
                const failureCount = (subscription.failureCount || 0) + 1;
                let newStatus = subscription.status;
                let nextRetryDate: string | null = null;

                // Retry schedule: 1st fail -> retry in 2 days, 2nd fail -> retry in 3 days, 3rd fail -> suspend
                // For test billing cycle, retry in 1 minute instead
                if (failureCount < 3) {
                    if (subscription.billingCycle === "test") {
                        // For test, retry in 1 minute
                        nextRetryDate = new Date(
                            Date.now() + 60 * 1000,
                        ).toISOString();
                        console.log(
                            `🔄 Scheduling retry for user ${userId} in 1 minute (test mode, attempt ${failureCount + 1}/3)`,
                        );
                    } else {
                        // Schedule next retry
                        const retryDays = failureCount === 1 ? 2 : 3; // 2 days after 1st fail, 3 days after 2nd
                        const retryDate = new Date();
                        retryDate.setDate(retryDate.getDate() + retryDays);
                        nextRetryDate = retryDate.toISOString().split("T")[0];
                        console.log(
                            `🔄 Scheduling retry for user ${userId} in ${retryDays} days (attempt ${failureCount + 1}/3)`,
                        );
                    }
                } else {
                    // 3번 연속 실패 시 구독 일시정지
                    newStatus = "suspended";
                    console.log(
                        `🚫 Subscription suspended for user ${userId} after ${failureCount} failures`,
                    );
                }

                // Update using Admin SDK
                await db
                    .collection("users")
                    .doc(userId)
                    .update({
                        "subscription.failureCount": failureCount,
                        "subscription.status": newStatus,
                        "subscription.lastFailureDate":
                            new Date().toISOString(),
                        "subscription.lastFailureReason": billingResult.error,
                        ...(nextRetryDate && {
                            "subscription.nextBillingDate": nextRetryDate,
                        }),
                        updatedAt: new Date().toISOString(),
                    });

                results.push({
                    userId,
                    success: false,
                    error: billingResult.error,
                });

                // 실패 알림 이메일 발송
                sendPaymentFailureNotification(userId, {
                    orderId: `RETRY-${userId.slice(-6)}-${Date.now()}`,
                    amount: subscription.amount,
                    reason:
                        billingResult.error ||
                        "결제 처리 중 오류가 발생했습니다.",
                    plan: subscription.plan,
                    isRecurring: true,
                    failureCount,
                    nextRetryDate: nextRetryDate || undefined,
                    isSuspended: newStatus === "suspended",
                }).catch((err) =>
                    console.error(
                        `Failed to send failure email for user ${userId}:`,
                        err,
                    ),
                );
            }

            // API 호출 간 짧은 딜레이 (선택사항)
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        console.log(
            `🏁 Scheduled billing completed. Processed: ${
                results.length
            }, Successful: ${results.filter((r) => r.success).length}`,
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
    userId: string,
): Promise<BillingResult> {
    try {
        const db = getFirebaseAdmin().firestore();
        const userDoc = await db.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            return { userId, success: false, error: "User not found" };
        }

        const subscription = userDoc.data()?.subscription;

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
            `Nova AI ${subscription.plan} 요금제 (즉시 결제)`,
        );

        if (billingResult.success) {
            const nextBillingDate = getNextBillingDate(
                subscription.billingCycle || "monthly",
            );

            await db
                .collection("users")
                .doc(userId)
                .update({
                    subscription: {
                        ...subscription,
                        nextBillingDate,
                        lastPaymentDate: new Date().toISOString(),
                        lastOrderId: billingResult.orderId,
                    },
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
