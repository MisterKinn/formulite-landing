import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

// Get Firebase Admin instance (uses centralized initialization)
const admin = getFirebaseAdmin();
const adminDb = admin.firestore();

/**
 * TossPayments Webhook Handler
 *
 * 지원하는 이벤트 타입:
 * - PAYMENT_STATUS_CHANGED: 결제 상태 변경 (DONE, CANCELED, PARTIAL_CANCELED, ABORTED, EXPIRED)
 * - CANCEL_STATUS_CHANGED: 결제 취소 상태 (IN_PROGRESS -> DONE, ABORTED)
 * - BILLING_DELETED: 빌링키 삭제
 * - DEPOSIT_CALLBACK: 가상계좌 입금/입금취소
 *
 * 웹훅 등록: https://developers.tosspayments.com 개발자센터 > 웹훅 메뉴
 * 웹훅 URL: https://yourdomain.com/api/webhooks/toss
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { eventType } = body;

        // 웹훅 이벤트 로깅 (디버깅/감사용)
        await logWebhookEvent(eventType, body);

        // 이벤트 타입별 처리
        switch (eventType) {
            case "PAYMENT_STATUS_CHANGED":
                await handlePaymentStatusChanged(body.data);
                break;

            case "CANCEL_STATUS_CHANGED":
                await handleCancelStatusChanged(body.data);
                break;

            case "BILLING_DELETED":
                await handleBillingDeleted(body.data);
                break;

            case "DEPOSIT_CALLBACK":
                await handleDepositCallback(body.data);
                break;

            default:
                console.log("Unknown webhook event type:", eventType);
        }

        // TossPayments는 10초 이내 200 응답을 기대
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Webhook processing error:", error);
        return NextResponse.json({
            success: false,
            error: "Processing failed",
        });
    }
}

async function logWebhookEvent(eventType: string, body: any) {
    try {
        const webhookLogRef = adminDb.collection("webhookLogs").doc();
        await webhookLogRef.set({
            eventType,
            body,
            receivedAt: new Date().toISOString(),
            processed: false,
        });
    } catch (err) {
        console.error("Failed to log webhook event:", err);
    }
}

async function handlePaymentStatusChanged(data: any) {
    const { paymentKey, orderId, status, customerKey } = data;

    console.log("PAYMENT_STATUS_CHANGED:", status, { paymentKey, orderId });

    const userId = extractUserId(customerKey);
    if (!userId) {
        console.log("No userId found from customerKey:", customerKey);
        return;
    }

    switch (status) {
        case "DONE":
            await handlePaymentDone(userId, data);
            break;

        case "CANCELED":
        case "PARTIAL_CANCELED":
            await handlePaymentCanceled(userId, data);
            break;

        case "ABORTED":
            console.log("Payment aborted for user", userId, ":", orderId);
            break;

        case "EXPIRED":
            console.log("Payment expired for user", userId, ":", orderId);
            break;

        default:
            console.log("Unhandled payment status:", status);
    }
}

async function handlePaymentDone(userId: string, data: any) {
    const {
        paymentKey,
        orderId,
        totalAmount,
        method,
        approvedAt,
        card,
        orderName,
    } = data;

    console.log("Payment completed for user", userId, ":", totalAmount);

    try {
        await adminDb
            .collection("users")
            .doc(userId)
            .collection("payments")
            .doc(paymentKey)
            .set({
                paymentKey,
                orderId,
                orderName: orderName || "",
                amount: totalAmount,
                method: method || "카드",
                status: "DONE",
                approvedAt,
                card: card
                    ? {
                          company: card.company || null,
                          number: card.number || null,
                      }
                    : null,
                createdAt: new Date().toISOString(),
            });

        const userDoc = await adminDb.collection("users").doc(userId).get();
        const userData = userDoc.data();

        if (userData?.subscription?.isRecurring) {
            const billingCycle =
                userData.subscription.billingCycle || "monthly";
            const nextBillingDate = getNextBillingDate(billingCycle);

            await adminDb.collection("users").doc(userId).update({
                "subscription.status": "active",
                "subscription.nextBillingDate": nextBillingDate,
                "subscription.lastPaymentDate": new Date().toISOString(),
                "subscription.lastOrderId": orderId,
                "subscription.failureCount": 0,
            });
        }

        await updateWebhookLog(paymentKey, true);
    } catch (err) {
        console.error("Error handling payment done:", err);
    }
}

async function handlePaymentCanceled(userId: string, data: any) {
    const { paymentKey, orderId, cancels } = data;

    console.log("Payment canceled for user", userId, ":", orderId);

    try {
        const paymentRef = adminDb
            .collection("users")
            .doc(userId)
            .collection("payments")
            .doc(paymentKey);
        const paymentDoc = await paymentRef.get();

        if (paymentDoc.exists) {
            await paymentRef.update({
                status: "CANCELED",
                cancels: cancels || [],
                canceledAt: new Date().toISOString(),
            });
        }

        const userDoc = await adminDb.collection("users").doc(userId).get();
        const userData = userDoc.data();

        if (userData?.subscription?.lastOrderId === orderId) {
            await adminDb.collection("users").doc(userId).update({
                "subscription.status": "cancelled",
                "subscription.cancelledAt": new Date().toISOString(),
            });
        }
    } catch (err) {
        console.error("Error handling payment canceled:", err);
    }
}

async function handleCancelStatusChanged(data: any) {
    const { paymentKey, orderId, cancelStatus } = data;

    console.log("CANCEL_STATUS_CHANGED:", cancelStatus, {
        paymentKey,
        orderId,
    });

    if (cancelStatus === "DONE") {
        console.log("Cancel completed successfully:", paymentKey);
    } else if (cancelStatus === "ABORTED") {
        console.log("Cancel failed:", paymentKey);
    }
}

async function handleBillingDeleted(data: any) {
    const { billingKey, customerKey } = data;

    console.log("BILLING_DELETED:", { billingKey, customerKey });

    const userId = extractUserId(customerKey);
    if (!userId) return;

    try {
        const userDoc = await adminDb.collection("users").doc(userId).get();
        const userData = userDoc.data();

        if (userData?.subscription?.billingKey === billingKey) {
            await adminDb.collection("users").doc(userId).update({
                "subscription.billingKey": FieldValue.delete(),
                "subscription.isRecurring": false,
                "subscription.status": "cancelled",
                "subscription.cancelledAt": new Date().toISOString(),
            });

            console.log("Billing key removed for user", userId);
        }
    } catch (err) {
        console.error("Error handling billing deleted:", err);
    }
}

async function handleDepositCallback(data: any) {
    const { orderId, status } = data;

    console.log("DEPOSIT_CALLBACK:", status, { orderId });

    if (status === "DONE") {
        console.log("Virtual account deposit completed:", orderId);
    } else if (status === "CANCELED") {
        console.log("Virtual account deposit canceled:", orderId);
    }
}

async function updateWebhookLog(paymentKey: string, processed: boolean) {
    try {
        const logsQuery = await adminDb
            .collection("webhookLogs")
            .where("body.data.paymentKey", "==", paymentKey)
            .orderBy("receivedAt", "desc")
            .limit(1)
            .get();

        if (!logsQuery.empty) {
            await logsQuery.docs[0].ref.update({
                processed,
                processedAt: new Date().toISOString(),
            });
        }
    } catch (err) {
        // Ignore log update failures
    }
}

function extractUserId(customerKey: string | undefined): string | null {
    if (!customerKey) return null;

    if (customerKey.startsWith("customer_")) {
        const parts = customerKey.split("_");
        if (parts.length >= 2) {
            return parts[1];
        }
    }

    if (customerKey.length >= 20 && !customerKey.includes("@")) {
        return customerKey;
    }

    return null;
}

function getNextBillingDate(billingCycle: "monthly" | "yearly"): string {
    const date = new Date();
    if (billingCycle === "yearly") {
        date.setFullYear(date.getFullYear() + 1);
    } else {
        date.setMonth(date.getMonth() + 1);
    }
    return date.toISOString().split("T")[0];
}
