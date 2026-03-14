export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";

const db = admin.firestore();

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

function inferBillingCycleFromPayment(payment: {
    orderName?: unknown;
    amount?: unknown;
}): "monthly" | "yearly" | "test" | null {
    const orderName = String(payment.orderName || "").toLowerCase();
    if (
        orderName.includes("연간") ||
        orderName.includes("yearly") ||
        orderName.includes("annual")
    ) {
        return "yearly";
    }
    if (orderName.includes("월간") || orderName.includes("monthly")) {
        return "monthly";
    }
    if (orderName.includes("test") || orderName.includes("테스트")) {
        return "test";
    }

    const amount = Number(payment.amount || 0);
    if ([99960, 251160, 831600, 712800].includes(amount)) return "yearly";
    if ([11900, 29900, 99000, 120, 100, 60].includes(amount)) return "monthly";
    return null;
}

function isProductPayment(payment: { orderName?: unknown; amount?: unknown }) {
    const orderName = String(payment.orderName || "").toLowerCase();
    if (PRODUCT_KEYWORDS.some((keyword) => orderName.includes(keyword))) {
        return true;
    }

    const amount = Number(payment.amount || 0);
    return KNOWN_PRODUCT_AMOUNTS.has(amount);
}

function isRefundStatus(status: unknown) {
    return (
        status === "REFUNDED" ||
        status === "CANCELED" ||
        status === "PARTIAL_REFUNDED" ||
        status === "PARTIAL_CANCELED"
    );
}

function getDateKey(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return formatter.format(date);
}

async function getAuthUserCount(): Promise<number> {
    let pageToken: string | undefined = undefined;
    let total = 0;

    do {
        const result = await admin.auth().listUsers(1000, pageToken);
        total += result.users.length;
        pageToken = result.pageToken;
    } while (pageToken);

    return total;
}

function getEmptyStats() {
    return {
        dailyVisitors: 0,
        dailyDownloads: 0,
        todaySales: 0,
        totalSignups: 0,
        dailyRevenue: [],
        totalUsers: 0,
        subscriptions: {
            active: 0,
            cancelled: 0,
            suspended: 0,
            free: 0,
        },
        planCounts: {
            free: 0,
            go: 0,
            plus: 0,
            pro: 0,
        },
        revenue: {
            monthlyRecurring: 0,
            yearlyRecurring: 0,
            totalMRR: 0,
        },
        recentActivity: {
            payments: { count: 0, total: 0 },
            refunds: { count: 0, total: 0 },
        },
    };
}

/**
 * GET /api/admin/stats
 * Returns dashboard statistics for admin
 */
export async function GET(request: NextRequest) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));

    if (!adminUser) {
        return NextResponse.json(
            { error: "Unauthorized - Admin access required" },
            { status: 403 },
        );
    }

    try {
        const usersRef = db.collection("users");
        const todayKey = getDateKey();
        const todayAnalyticsRef = db.collection("analyticsDaily").doc(todayKey);

        // Get all users
        const [usersSnapshot, todayAnalyticsSnap] = await Promise.all([
            usersRef.get(),
            todayAnalyticsRef.get(),
        ]);
        const authUserCount = await getAuthUserCount();
        const totalUsers = authUserCount || usersSnapshot.size;
        const totalSignups = totalUsers;
        const dailyVisitors = todayAnalyticsSnap.exists
            ? (todayAnalyticsSnap.data()?.visitors ?? 0)
            : 0;
        const dailyDownloads = todayAnalyticsSnap.exists
            ? (todayAnalyticsSnap.data()?.downloads ?? 0)
            : 0;

        let activeSubscriptions = 0;
        let cancelledSubscriptions = 0;
        let suspendedSubscriptions = 0;
        let freeUsers = 0;
        let monthlyRevenue = 0;
        let yearlyRevenue = 0;

        const planCounts: Record<string, number> = {
            free: 0,
            go: 0,
            plus: 0,
            pro: 0,
        };

        usersSnapshot.forEach((doc) => {
            const data = doc.data();
            const subscription = data.subscription;

            if (
                !subscription ||
                subscription.plan === "free" ||
                !subscription.plan
            ) {
                freeUsers++;
                planCounts.free++;
            } else {
                planCounts[subscription.plan] =
                    (planCounts[subscription.plan] || 0) + 1;

                if (subscription.status === "active") {
                    activeSubscriptions++;
                } else if (subscription.status === "cancelled") {
                    cancelledSubscriptions++;
                } else if (subscription.status === "suspended") {
                    suspendedSubscriptions++;
                }
            }
        });

        // Firestore users 문서가 누락된 Auth 사용자 수를 free로 보정
        const missingFirestoreUsers = Math.max(
            authUserCount - usersSnapshot.size,
            0,
        );
        if (missingFirestoreUsers > 0) {
            freeUsers += missingFirestoreUsers;
            planCounts.free += missingFirestoreUsers;
        }

        // Get recent payments (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        let recentPaymentsCount = 0;
        let recentPaymentsTotal = 0;
        let recentRefundsCount = 0;
        let recentRefundsTotal = 0;
        let todaySales = 0;
        const dailyRevenueMap: Record<
            string,
            { totalSales: number; paymentCount: number }
        > = {};

        // Query all users and their payments subcollection
        for (const userDoc of usersSnapshot.docs) {
            const paymentsRef = db
                .collection("users")
                .doc(userDoc.id)
                .collection("payments");
            const paymentsSnapshot = await paymentsRef
                .where("approvedAt", ">=", thirtyDaysAgo.toISOString())
                .get();

            paymentsSnapshot.forEach((paymentDoc) => {
                const payment = paymentDoc.data();
                if (!isProductPayment(payment)) {
                    return;
                }

                const amount = Number(payment.amount || 0);
                const billingCycle = inferBillingCycleFromPayment(payment);
                if (payment.status === "DONE") {
                    recentPaymentsCount++;
                    recentPaymentsTotal += amount;

                    if (billingCycle === "yearly") {
                        yearlyRevenue += amount;
                    } else {
                        monthlyRevenue += amount;
                    }

                    const approvedAt = payment.approvedAt
                        ? new Date(payment.approvedAt)
                        : null;
                    const dateKey =
                        approvedAt && !Number.isNaN(approvedAt.getTime())
                            ? getDateKey(approvedAt)
                            : "";
                    if (dateKey) {
                        const prev = dailyRevenueMap[dateKey] || {
                            totalSales: 0,
                            paymentCount: 0,
                        };
                        dailyRevenueMap[dateKey] = {
                            totalSales: prev.totalSales + amount,
                            paymentCount: prev.paymentCount + 1,
                        };
                        if (dateKey === todayKey) {
                            todaySales += amount;
                        }
                    }
                } else if (isRefundStatus(payment.status)) {
                    recentRefundsCount++;
                    recentRefundsTotal += amount;
                }
            });
        }

        const dailyRevenue = Object.entries(dailyRevenueMap)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, revenue]) => ({
                date,
                totalSales: revenue.totalSales,
                paymentCount: revenue.paymentCount,
            }));

        return NextResponse.json({
            dailyVisitors,
            dailyDownloads,
            todaySales,
            totalSignups,
            dailyRevenue,
            totalUsers,
            subscriptions: {
                active: activeSubscriptions,
                cancelled: cancelledSubscriptions,
                suspended: suspendedSubscriptions,
                free: freeUsers,
            },
            planCounts,
            revenue: {
                monthlyRecurring: monthlyRevenue,
                yearlyRecurring: yearlyRevenue,
                totalMRR: monthlyRevenue + Math.round(yearlyRevenue / 12), // Monthly Recurring Revenue
            },
            recentActivity: {
                payments: {
                    count: recentPaymentsCount,
                    total: recentPaymentsTotal,
                },
                refunds: {
                    count: recentRefundsCount,
                    total: recentRefundsTotal,
                },
            },
        });
    } catch (error) {
        console.error("Admin stats error:", error);
        return NextResponse.json({
            ...getEmptyStats(),
            warning:
                "firebase_admin_not_configured: check FIREBASE_ADMIN_CREDENTIALS and project settings",
        });
    }
}
