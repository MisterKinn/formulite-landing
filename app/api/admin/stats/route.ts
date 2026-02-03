export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";

const db = admin.firestore();

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

        // Get all users
        const usersSnapshot = await usersRef.get();
        const totalUsers = usersSnapshot.size;

        let activeSubscriptions = 0;
        let cancelledSubscriptions = 0;
        let suspendedSubscriptions = 0;
        let freeUsers = 0;
        let monthlyRevenue = 0;
        let yearlyRevenue = 0;

        const planCounts: Record<string, number> = {
            free: 0,
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

        // Get recent payments (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        let recentPaymentsCount = 0;
        let recentPaymentsTotal = 0;
        let recentRefundsCount = 0;
        let recentRefundsTotal = 0;

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
                } else if (payment.status === "REFUNDED") {
                    recentRefundsCount++;
                    recentRefundsTotal += payment.amount || 0;
                }
            });
        }

        return NextResponse.json({
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
        return NextResponse.json(
            { error: "Failed to fetch stats" },
            { status: 500 },
        );
    }
}
