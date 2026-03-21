export const runtime = "nodejs";

import { NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import {
    RECENT_PURCHASE_FEED_LIMIT,
    getRecentPurchaseFeedItems,
    inferBillingLabel,
    inferPlanLabel,
    formatRelativeTime,
    isProductPayment,
    maskEmail,
    saveRecentPurchaseFeedItems,
} from "@/lib/recentPurchaseFeed";

const QUERY_LIMIT = 30;
const MAX_ITEMS = RECENT_PURCHASE_FEED_LIMIT;

interface RecentPaymentRecord {
    userId: string;
    paymentKey: string;
    orderName: string;
    amount: number;
    status: string;
    approvedAt: string;
}

async function queryCollectionGroupPayments(db: FirebaseFirestore.Firestore) {
    const snapshot = await db
        .collectionGroup("payments")
        .orderBy("approvedAt", "desc")
        .limit(QUERY_LIMIT)
        .get();

    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            userId: doc.ref.parent.parent?.id || "",
            paymentKey: String(data.paymentKey || doc.id),
            orderName: String(data.orderName || ""),
            amount: Number(data.amount || 0),
            status: String(data.status || ""),
            approvedAt: String(data.approvedAt || ""),
        } satisfies RecentPaymentRecord;
    });
}

async function queryFallbackPayments(db: FirebaseFirestore.Firestore) {
    const usersSnapshot = await db.collection("users").select("email").get();
    const paymentRecords: RecentPaymentRecord[] = [];

    for (const userDoc of usersSnapshot.docs) {
        const paymentsSnapshot = await userDoc.ref
            .collection("payments")
            .orderBy("approvedAt", "desc")
            .limit(5)
            .get();

        paymentsSnapshot.forEach((paymentDoc) => {
            const data = paymentDoc.data();
            paymentRecords.push({
                userId: userDoc.id,
                paymentKey: String(data.paymentKey || paymentDoc.id),
                orderName: String(data.orderName || ""),
                amount: Number(data.amount || 0),
                status: String(data.status || ""),
                approvedAt: String(data.approvedAt || ""),
            });
        });
    }

    paymentRecords.sort((a, b) => {
        const left = new Date(a.approvedAt).getTime() || 0;
        const right = new Date(b.approvedAt).getTime() || 0;
        return right - left;
    });

    return paymentRecords.slice(0, QUERY_LIMIT);
}

async function getRecentPayments(db: FirebaseFirestore.Firestore) {
    try {
        return await queryCollectionGroupPayments(db);
    } catch (error) {
        console.warn(
            "[recent-live] collectionGroup query failed, falling back to per-user lookup",
            error,
        );
        return queryFallbackPayments(db);
    }
}

export async function GET() {
    try {
        const storedItems = await getRecentPurchaseFeedItems();
        if (storedItems.length > 0) {
            return NextResponse.json(
                { items: storedItems },
                {
                    headers: {
                        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
                    },
                },
            );
        }

        const admin = getFirebaseAdmin();
        const db = admin.firestore();
        const payments = await getRecentPayments(db);
        const filteredPayments = payments
            .filter(
                (payment) =>
                    payment.status === "DONE" &&
                    payment.approvedAt &&
                    isProductPayment(payment),
            )
            .slice(0, MAX_ITEMS);

        const userIds = [...new Set(filteredPayments.map((payment) => payment.userId))].filter(
            Boolean,
        );
        const userDocs = await Promise.all(
            userIds.map((userId) => db.collection("users").doc(userId).get()),
        );
        const authUsersResult = userIds.length
            ? await admin.auth().getUsers(
                  userIds.map((uid) => ({
                      uid,
                  })),
              )
            : { users: [] };
        const emailByUserId = new Map<string, string>();
        const authEmailByUserId = new Map(
            authUsersResult.users.map((user) => [user.uid, user.email || ""]),
        );

        userDocs.forEach((userDoc) => {
            const data = userDoc.data();
            emailByUserId.set(
                userDoc.id,
                authEmailByUserId.get(userDoc.id) || String(data?.email || ""),
            );
        });

        const items = filteredPayments.map((payment, index) => ({
            id: payment.paymentKey || `${payment.userId}-${index}`,
            email: maskEmail(emailByUserId.get(payment.userId) || "고객"),
            planLabel: inferPlanLabel(payment.orderName, payment.amount),
            billingLabel: inferBillingLabel(payment.orderName, payment.amount),
            relativeTime: formatRelativeTime(payment.approvedAt),
            approvedAt: payment.approvedAt,
            amountLabel: `${payment.amount.toLocaleString("ko-KR")}원`,
        }));

        await saveRecentPurchaseFeedItems(items);

        return NextResponse.json(
            { items },
            {
                headers: {
                    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
                },
            },
        );
    } catch (error) {
        console.error("[recent-live] failed to load recent purchase feed", error);
        return NextResponse.json({ items: [] });
    }
}
