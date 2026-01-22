export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";

const db = admin.firestore();

/**
 * GET /api/admin/users
 * Returns list of all users with subscription info
 * Query params: limit, offset, search (email), plan, status
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
        const planFilter = searchParams.get("plan");
        const statusFilter = searchParams.get("status");

        const usersRef = db.collection("users");
        const usersSnapshot = await usersRef.get();

        let users: any[] = [];

        usersSnapshot.forEach((doc) => {
            const data = doc.data();
            const subscription = data.subscription || {};

            // Apply filters
            const email = data.email?.toLowerCase() || "";
            const displayName = data.displayName?.toLowerCase() || "";
            const plan = subscription.plan || "free";
            const status = subscription.status || "none";

            // Search filter
            if (
                search &&
                !email.includes(search) &&
                !displayName.includes(search)
            ) {
                return;
            }

            // Plan filter
            if (planFilter && plan !== planFilter) {
                return;
            }

            // Status filter
            if (statusFilter && status !== statusFilter) {
                return;
            }

            users.push({
                uid: doc.id,
                email: data.email,
                displayName: data.displayName,
                photoURL: data.photoURL,
                createdAt: data.createdAt,
                subscription: {
                    plan: plan,
                    status: status,
                    amount: subscription.amount || 0,
                    billingCycle: subscription.billingCycle || "monthly",
                    startDate: subscription.startDate,
                    nextBillingDate: subscription.nextBillingDate,
                    failureCount: subscription.failureCount || 0,
                    lastFailureReason: subscription.lastFailureReason,
                },
            });
        });

        // Sort by createdAt descending
        users.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        const total = users.length;

        // Apply pagination
        users = users.slice(offset, offset + limit);

        return NextResponse.json({
            users,
            total,
            limit,
            offset,
        });
    } catch (error) {
        console.error("Admin users error:", error);
        return NextResponse.json(
            { error: "Failed to fetch users" },
            { status: 500 },
        );
    }
}
