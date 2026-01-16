import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { getTierLimit, PlanTier } from "@/lib/tierLimits";

/**
 * Check if user can make an AI call
 * GET /api/ai/check-limit?userId={userId}
 */
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json(
                { error: "userId is required" },
                { status: 400 }
            );
        }

        const admin = await getFirebaseAdmin();
        const db = admin.firestore();
        const userDoc = await db.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data() || {};
        const plan = (userData.plan || "free") as PlanTier;
        const currentUsage = userData.aiCallUsage || 0;
        const limit = getTierLimit(plan);
        const canUse = currentUsage < limit;

        return NextResponse.json({
            success: true,
            plan,
            currentUsage,
            limit,
            remaining: Math.max(0, limit - currentUsage),
            canUse,
        });
    } catch (error) {
        console.error("Error checking AI limit:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
