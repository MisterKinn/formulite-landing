import getFirebaseAdmin from "./firebaseAdmin";

export interface PaymentRecord {
    paymentKey: string;
    orderId: string;
    amount: number;
    orderName: string;
    method: string;
    status: "DONE" | "REFUNDED" | "PARTIAL_REFUNDED";
    approvedAt: string;
    card?: {
        company: string | null;
        number: string | null;
    } | null;
    refundedAt?: string | null;
    refundAmount?: number | null;
    refundReason?: string | null;
}

/**
 * Save a payment record to user's payment history
 */
export async function savePaymentRecord(
    userId: string,
    payment: PaymentRecord,
): Promise<void> {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    await db
        .collection("users")
        .doc(userId)
        .collection("payments")
        .doc(payment.paymentKey)
        .set({
            ...payment,
            createdAt: new Date().toISOString(),
        });
}

/**
 * Get user's payment history
 */
export async function getPaymentHistory(
    userId: string,
    limit: number = 20,
): Promise<PaymentRecord[]> {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    const snapshot = await db
        .collection("users")
        .doc(userId)
        .collection("payments")
        .orderBy("approvedAt", "desc")
        .limit(limit)
        .get();

    return snapshot.docs.map((doc) => doc.data() as PaymentRecord);
}

/**
 * Update payment record (e.g., for refund)
 */
export async function updatePaymentRecord(
    userId: string,
    paymentKey: string,
    updates: Partial<PaymentRecord>,
): Promise<void> {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    await db
        .collection("users")
        .doc(userId)
        .collection("payments")
        .doc(paymentKey)
        .update({
            ...updates,
            updatedAt: new Date().toISOString(),
        });
}

/**
 * Check if payment is refundable (within 7 days)
 */
export function isRefundable(approvedAt: string): boolean {
    const paymentDate = new Date(approvedAt);
    const now = new Date();
    const diffDays =
        (now.getTime() - paymentDate.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
}
