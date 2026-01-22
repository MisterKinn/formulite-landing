export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";

const db = admin.firestore();

/**
 * GET /api/admin/payments
 * Returns list of all payments with search/filter capabilities
 * Query params: limit, offset, search (email), status, startDate, endDate, minAmount, maxAmount
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
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get("limit") || "50");
        const offset = parseInt(searchParams.get("offset") || "0");
        const search = searchParams.get("search")?.toLowerCase();
        const statusFilter = searchParams.get("status");
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");
        const minAmount = searchParams.get("minAmount")
            ? parseInt(searchParams.get("minAmount")!)
            : null;
        const maxAmount = searchParams.get("maxAmount")
            ? parseInt(searchParams.get("maxAmount")!)
            : null;

        // Get all users first to map email to payments
        const usersSnapshot = await db.collection("users").get();
        const userEmails: Record<string, string> = {};

        usersSnapshot.forEach((doc) => {
            const data = doc.data();
            userEmails[doc.id] = data.email || "Unknown";
        });

        let allPayments: any[] = [];

        // Query all users' payments subcollections
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const userEmail = userEmails[userId];

            // Search filter - skip users that don't match email search
            if (search && !userEmail.toLowerCase().includes(search)) {
                continue;
            }

            const paymentsRef = db
                .collection("users")
                .doc(userId)
                .collection("payments");
            let query = paymentsRef.orderBy("approvedAt", "desc");

            const paymentsSnapshot = await query.get();

            paymentsSnapshot.forEach((paymentDoc) => {
                const payment = paymentDoc.data();

                // Apply filters
                // Status filter
                if (statusFilter && payment.status !== statusFilter) {
                    return;
                }

                // Date filters
                if (startDate && payment.approvedAt < startDate) {
                    return;
                }
                if (endDate && payment.approvedAt > endDate + "T23:59:59") {
                    return;
                }

                // Amount filters
                if (minAmount !== null && payment.amount < minAmount) {
                    return;
                }
                if (maxAmount !== null && payment.amount > maxAmount) {
                    return;
                }

                allPayments.push({
                    paymentKey: payment.paymentKey,
                    userId,
                    userEmail,
                    orderId: payment.orderId,
                    orderName: payment.orderName,
                    amount: payment.amount,
                    method: payment.method,
                    status: payment.status,
                    approvedAt: payment.approvedAt,
                    card: payment.card,
                    createdAt: payment.createdAt,
                });
            });
        }

        // Sort by approvedAt descending
        allPayments.sort((a, b) => {
            const dateA = a.approvedAt ? new Date(a.approvedAt).getTime() : 0;
            const dateB = b.approvedAt ? new Date(b.approvedAt).getTime() : 0;
            return dateB - dateA;
        });

        const total = allPayments.length;

        // Apply pagination
        const payments = allPayments.slice(offset, offset + limit);

        // Calculate totals
        const totalAmount = allPayments
            .filter((p) => p.status === "DONE")
            .reduce((sum, p) => sum + (p.amount || 0), 0);

        const refundedAmount = allPayments
            .filter((p) => p.status === "REFUNDED")
            .reduce((sum, p) => sum + (p.amount || 0), 0);

        return NextResponse.json({
            payments,
            total,
            limit,
            offset,
            summary: {
                totalAmount,
                refundedAmount,
                netAmount: totalAmount - refundedAmount,
            },
        });
    } catch (error) {
        console.error("Admin payments error:", error);
        return NextResponse.json(
            { error: "Failed to fetch payments" },
            { status: 500 },
        );
    }
}
