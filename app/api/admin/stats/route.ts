export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";

const db = admin.firestore();

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

                    // Calculate revenue
                    const amount = subscription.amount || 0;
                    if (subscription.billingCycle === "yearly") {
                        yearlyRevenue += amount;
                    } else {
                        monthlyRevenue += amount;
                    }
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
                if (payment.status === "DONE") {
                    recentPaymentsCount++;
                    recentPaymentsTotal += payment.amount || 0;
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
                        const amount = payment.amount || 0;
                        dailyRevenueMap[dateKey] = {
                            totalSales: prev.totalSales + amount,
                            paymentCount: prev.paymentCount + 1,
                        };
                        if (dateKey === todayKey) {
                            todaySales += amount;
                        }
                    }
                } else if (payment.status === "REFUNDED") {
                    recentRefundsCount++;
                    recentRefundsTotal += payment.amount || 0;
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
