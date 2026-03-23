import getFirebaseAdmin from "./firebaseAdmin";

export const RECENT_PURCHASE_FEED_LIMIT = 10;

const COLLECTION_NAME = "recentPurchaseFeed";
const PRODUCT_KEYWORDS = ["요금제", "구독", "plan", "pricing"] as const;
const KNOWN_PRODUCT_AMOUNTS = new Set([
    60,
    100,
    120,
    720,
    840,
    11900,
    29900,
    59400,
    99000,
    99960,
    251160,
    712800,
    831600,
]);

export interface RecentPurchaseFeedItem {
    id: string;
    email: string;
    planLabel: string;
    billingLabel: string;
    relativeTime: string;
    approvedAt: string;
    amountLabel: string;
}

interface RecentPurchaseSource {
    userId: string;
    paymentKey: string;
    orderName: string;
    amount: number;
    status: string;
    approvedAt: string;
}

interface PersistedRecentPurchaseFeedItem {
    email: string;
    planLabel: string;
    billingLabel: string;
    approvedAt: string;
    amountLabel: string;
    orderName?: string;
    amount?: number;
    userId?: string;
    status?: string;
    updatedAt?: string;
    createdAt?: string;
}

export function isProductPayment(payment: {
    orderName?: unknown;
    amount?: unknown;
}) {
    const orderName = String(payment.orderName || "").toLowerCase();
    if (PRODUCT_KEYWORDS.some((keyword) => orderName.includes(keyword))) {
        return true;
    }

    if (
        orderName.includes("monthly") ||
        orderName.includes("yearly") ||
        orderName.includes("annual") ||
        orderName.includes("월간") ||
        orderName.includes("연간")
    ) {
        return true;
    }

    const amount = Number(payment.amount || 0);
    return KNOWN_PRODUCT_AMOUNTS.has(amount);
}

export function inferPlanLabel(orderName: string, amount: number) {
    const normalized = orderName.toLowerCase();

    if (normalized.includes("ultra")) return "Ultra 요금제";
    if (normalized.includes("plus")) return "Plus 요금제";
    if (normalized.includes("go")) return "Go 요금제";
    if (normalized.includes("free")) return "Free 요금제";
    if ([99000, 831600, 712800].includes(amount)) return "Ultra 요금제";
    if ([29900, 251160, 59400].includes(amount)) return "Plus 요금제";
    if ([11900, 99960, 60, 100, 120, 720, 840].includes(amount)) return "Go 요금제";

    const cleaned = orderName
        .replace(/^Nova AI\s*/i, "")
        .replace(/\s*\(.+?\)\s*/g, "")
        .trim();

    return cleaned || "Nova AI 요금제";
}

export function inferBillingLabel(orderName: string, amount: number) {
    const normalized = orderName.toLowerCase();

    if (
        normalized.includes("연간") ||
        normalized.includes("yearly") ||
        normalized.includes("annual") ||
        [99960, 251160, 712800, 831600].includes(amount)
    ) {
        return "연간 결제";
    }

    if (
        normalized.includes("월간") ||
        normalized.includes("monthly") ||
        [60, 100, 120, 11900, 29900, 59400, 99000].includes(amount)
    ) {
        return "월간 결제";
    }

    if (normalized.includes("구독")) {
        return normalized.includes("연간") ? "연간 구독" : "월간 구독";
    }

    return "플랜 구매";
}

export function formatRelativeTime(approvedAt: string) {
    const approvedDate = new Date(approvedAt);

    if (Number.isNaN(approvedDate.getTime())) {
        return "방금 전";
    }

    const diffMs = Date.now() - approvedDate.getTime();
    const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

    if (diffMinutes < 60) return `${diffMinutes}분 전`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}시간 전`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}일 전`;

    return approvedDate.toLocaleDateString("ko-KR", {
        month: "numeric",
        day: "numeric",
    });
}

export function maskEmail(email: string) {
    const normalized = email.trim();

    if (!normalized) {
        return "고객";
    }

    if (normalized.length <= 2) {
        return normalized;
    }

    return `${normalized.slice(0, 2)}***`;
}

async function resolveMaskedEmail(userId: string) {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    try {
        const authUser = await admin.auth().getUser(userId);
        if (authUser.email) {
            return maskEmail(authUser.email);
        }
    } catch (error) {
        console.warn("[recentPurchaseFeed] auth email lookup failed", { userId, error });
    }

    try {
        const userDoc = await db.collection("users").doc(userId).get();
        const email = String(userDoc.data()?.email || "");
        return maskEmail(email);
    } catch (error) {
        console.warn("[recentPurchaseFeed] user doc email lookup failed", { userId, error });
        return "고객";
    }
}

export async function saveRecentPurchaseFeedItem(payment: RecentPurchaseSource) {
    if (
        payment.status !== "DONE" ||
        !payment.approvedAt ||
        !isProductPayment(payment)
    ) {
        return;
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const now = new Date().toISOString();
    const email = await resolveMaskedEmail(payment.userId);

    await db
        .collection(COLLECTION_NAME)
        .doc(payment.paymentKey)
        .set(
            {
                userId: payment.userId,
                email,
                planLabel: inferPlanLabel(payment.orderName, payment.amount),
                billingLabel: inferBillingLabel(payment.orderName, payment.amount),
                approvedAt: payment.approvedAt,
                amountLabel: `${payment.amount.toLocaleString("ko-KR")}원`,
                amount: payment.amount,
                orderName: payment.orderName,
                status: payment.status,
                updatedAt: now,
                createdAt: now,
            } satisfies PersistedRecentPurchaseFeedItem,
            { merge: true },
        );
}

export async function saveRecentPurchaseFeedItems(items: RecentPurchaseFeedItem[]) {
    if (items.length === 0) {
        return;
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const batch = db.batch();
    const now = new Date().toISOString();

    items.slice(0, RECENT_PURCHASE_FEED_LIMIT).forEach((item) => {
        const ref = db.collection(COLLECTION_NAME).doc(item.id);
        batch.set(
            ref,
            {
                email: item.email,
                planLabel: item.planLabel,
                billingLabel: item.billingLabel,
                approvedAt: item.approvedAt,
                amountLabel: item.amountLabel,
                updatedAt: now,
                createdAt: now,
            } satisfies PersistedRecentPurchaseFeedItem,
            { merge: true },
        );
    });

    await batch.commit();
}

export async function removeRecentPurchaseFeedItem(paymentKey: string) {
    if (!paymentKey) {
        return;
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    await db.collection(COLLECTION_NAME).doc(paymentKey).delete();
}

export async function getRecentPurchaseFeedItems(
    limit: number = RECENT_PURCHASE_FEED_LIMIT,
): Promise<RecentPurchaseFeedItem[]> {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const snapshot = await db
        .collection(COLLECTION_NAME)
        .orderBy("approvedAt", "desc")
        .limit(limit)
        .get();

    return snapshot.docs.map((doc) => {
        const data = doc.data() as PersistedRecentPurchaseFeedItem;
        return {
            id: doc.id,
            email: String(data.email || "고객"),
            planLabel: String(data.planLabel || "Nova AI 요금제"),
            billingLabel: String(data.billingLabel || "플랜 구매"),
            relativeTime: formatRelativeTime(String(data.approvedAt || "")),
            approvedAt: String(data.approvedAt || ""),
            amountLabel: String(data.amountLabel || "0원"),
        };
    });
}
