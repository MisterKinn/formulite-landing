export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";
import { getTierLimit } from "@/lib/tierLimits";
import { resolveEffectiveUsagePlan } from "@/lib/aiUsage";

const db = admin.firestore();
const ALLOWED_PLANS = ["free", "go", "plus", "pro"] as const;
type EditablePlan = (typeof ALLOWED_PLANS)[number];

function isEditablePlan(value: unknown): value is EditablePlan {
    return (
        typeof value === "string" &&
        ALLOWED_PLANS.includes(value.toLowerCase() as EditablePlan)
    );
}

/**
 * PATCH /api/admin/users/[userId]
 * Updates user's plan and/or remaining AI usage for current cycle/day.
 * Body: { remainingUsage?: number, plan?: "free" | "go" | "plus" | "pro" }
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> },
) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));

    if (!adminUser) {
        return NextResponse.json(
            { error: "Unauthorized - Admin access required" },
            { status: 403 },
        );
    }

    const { userId } = await params;
    if (!userId) {
        return NextResponse.json(
            { error: "User ID is required" },
            { status: 400 },
        );
    }

    try {
        const body = (await request.json()) as {
            remainingUsage?: unknown;
            plan?: unknown;
        };
        const hasRemainingUsage = body.remainingUsage !== undefined;
        const hasPlan = body.plan !== undefined;
        if (!hasRemainingUsage && !hasPlan) {
            return NextResponse.json(
                { error: "At least one of remainingUsage or plan is required" },
                { status: 400 },
            );
        }

        let requestedPlan: EditablePlan | undefined = undefined;
        if (hasPlan) {
            if (!isEditablePlan(body.plan)) {
                return NextResponse.json(
                    { error: "plan must be one of: free, go, plus, pro" },
                    { status: 400 },
                );
            }
            requestedPlan = body.plan.toLowerCase() as EditablePlan;
        }

        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        const userData = (userDoc.data() || {}) as Record<string, any>;
        const currentUsage = Math.max(0, Number(userData.aiCallUsage || 0));
        const effectivePlan = resolveEffectiveUsagePlan(userData);
        const nextPlan = requestedPlan || effectivePlan;
        const usageLimit = getTierLimit(nextPlan);

        let nextUsage = Math.min(currentUsage, usageLimit);
        if (hasRemainingUsage) {
            const remainingUsage = Number(body.remainingUsage);
            if (!Number.isFinite(remainingUsage) || remainingUsage < 0) {
                return NextResponse.json(
                    { error: "remainingUsage must be a non-negative number" },
                    { status: 400 },
                );
            }
            if (remainingUsage > usageLimit) {
                return NextResponse.json(
                    {
                        error: `remainingUsage cannot exceed current plan limit (${usageLimit})`,
                    },
                    { status: 400 },
                );
            }
            nextUsage = Math.max(0, usageLimit - Math.floor(remainingUsage));
        }

        const nowIso = new Date().toISOString();
        const updatePayload: Record<string, any> = {
            aiCallUsage: nextUsage,
            updatedAt: nowIso,
        };
        if (requestedPlan) {
            updatePayload.plan = requestedPlan;
            updatePayload.tier = requestedPlan;
            updatePayload.subscription = {
                ...(userData.subscription || {}),
                plan: requestedPlan,
            };
        }

        await userRef.set(
            updatePayload,
            { merge: true },
        );

        return NextResponse.json({
            success: true,
            subscription: {
                ...((userData.subscription || {}) as Record<string, any>),
                plan: requestedPlan || userData.subscription?.plan || effectivePlan,
            },
            usage: {
                today: nextUsage,
                limit: usageLimit,
                remaining: Math.max(0, usageLimit - nextUsage),
            },
        });
    } catch (error) {
        console.error("Update user usage error:", error);
        return NextResponse.json(
            {
                error: "Failed to update user usage",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        );
    }
}

/**
 * DELETE /api/admin/users/[userId]
 * Deletes a user from Firebase Auth and Firestore (including payments subcollection)
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> },
) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));

    if (!adminUser) {
        return NextResponse.json(
            { error: "Unauthorized - Admin access required" },
            { status: 403 },
        );
    }

    const { userId } = await params;

    if (!userId) {
        return NextResponse.json(
            { error: "User ID is required" },
            { status: 400 },
        );
    }

    // Prevent admin from deleting themselves
    if (userId === adminUser.uid) {
        return NextResponse.json(
            { error: "Cannot delete your own account" },
            { status: 400 },
        );
    }

    try {
        // 1) Delete from Firebase Auth first so we don't report success while auth user still exists.
        let deletedAuthUser = false;
        try {
            await admin.auth().getUser(userId);
            await admin.auth().deleteUser(userId);
            deletedAuthUser = true;
        } catch (authError: any) {
            if (authError?.code !== "auth/user-not-found") {
                console.error("Failed to delete user from Auth:", authError);
                return NextResponse.json(
                    {
                        error: "Failed to delete Firebase Auth user",
                        details:
                            authError instanceof Error
                                ? authError.message
                                : String(authError),
                    },
                    { status: 500 },
                );
            }
        }

        // 2) Delete payments subcollection first
        const paymentsRef = db
            .collection("users")
            .doc(userId)
            .collection("payments");
        const paymentsSnapshot = await paymentsRef.get();

        const batch = db.batch();
        paymentsSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });

        // 3) Delete user document from Firestore
        batch.delete(db.collection("users").doc(userId));

        await batch.commit();

        return NextResponse.json({
            success: true,
            message: "User deleted successfully",
            deletedAuthUser,
            deletedPayments: paymentsSnapshot.size,
        });
    } catch (error) {
        console.error("Delete user error:", error);
        return NextResponse.json(
            {
                error: "Failed to delete user",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        );
    }
}
