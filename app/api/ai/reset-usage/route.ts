import { NextRequest, NextResponse } from "next/server";
import { getFirestore, doc, updateDoc } from "firebase/firestore";
import { app } from "@/firebaseConfig";

/**
 * Reset AI usage counter (admin only or monthly reset)
 * POST /api/ai/reset-usage
 * Body: { userId: string }
 */
export async function POST(request: NextRequest) {
    try {
        // Simple admin authentication
        const authHeader = request.headers.get("authorization");
        const adminSecret = process.env.ADMIN_SECRET;

        if (process.env.NODE_ENV === "production") {
            if (
                !authHeader ||
                !adminSecret ||
                authHeader !== `Bearer ${adminSecret}`
            ) {
                return NextResponse.json(
                    { error: "Admin access required" },
                    { status: 401 }
                );
            }
        }

        const { userId } = await request.json();

        if (!userId) {
            return NextResponse.json(
                { error: "userId is required" },
                { status: 400 }
            );
        }

        const db = getFirestore(app);
        const userRef = doc(db, "users", userId);

        await updateDoc(userRef, {
            aiCallUsage: 0,
            usageResetAt: new Date().toISOString(),
        });

        return NextResponse.json({
            success: true,
            message: "Usage reset successfully",
        });
    } catch (error) {
        console.error("Error resetting AI usage:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
