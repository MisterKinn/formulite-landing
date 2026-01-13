import { NextRequest, NextResponse } from "next/server";
import {
    getFirestore,
    doc,
    getDoc,
    updateDoc,
    increment,
} from "firebase/firestore";
import { app } from "@/firebaseConfig";
import { getTierLimit, PlanTier } from "@/lib/tierLimits";

/**
 * Increment AI usage counter
 * POST /api/ai/increment-usage
 * Body: { userId: string }
 */
export async function POST(request: NextRequest) {
    try {
        const { userId } = await request.json();

        if (!userId) {
            return NextResponse.json(
                { error: "userId is required" },
                { status: 400 }
            );
        }

        const db = getFirestore(app);
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data();
        const plan = (userData.plan || "free") as PlanTier;
        const currentUsage = userData.aiCallUsage || 0;
        const limit = getTierLimit(plan);

        // Check if user has exceeded limit
        if (currentUsage >= limit) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Usage limit exceeded",
                    currentUsage,
                    limit,
                },
                { status: 429 } // Too Many Requests
            );
        }

        // Increment usage counter
        await updateDoc(userRef, {
            aiCallUsage: increment(1),
            lastAiCallAt: new Date().toISOString(),
        });

        const newUsage = currentUsage + 1;

        return NextResponse.json({
            success: true,
            currentUsage: newUsage,
            limit,
            remaining: Math.max(0, limit - newUsage),
        });
    } catch (error) {
        console.error("Error incrementing AI usage:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
