import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

// Generate unique session token for OAuth flow
export async function POST(request: NextRequest) {
    try {
        const admin = getFirebaseAdmin();
        const db = admin.firestore();

        // Generate unique session ID
        const sessionId = `session_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 15)}`;

        console.log("🔑 Creating new session:", sessionId);

        // Store session with pending status (expires in 10 minutes)
        await db
            .collection("oauth_sessions")
            .doc(sessionId)
            .set({
                status: "pending",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
            });

        const baseUrl =
            process.env.NEXT_PUBLIC_APP_URL ||
            process.env.NEXT_PUBLIC_BASE_URL ||
            "https://nova-ai.work";

        const response = {
            sessionId,
            loginUrl: `https://nova-ai.work/login?session=${sessionId}`,
        };

        console.log("📤 Sending to program:", response);

        return NextResponse.json(response);
    } catch (error) {
        console.error("Error creating session:", error);
        return NextResponse.json(
            { error: "Failed to create session" },
            { status: 500 }
        );
    }
}
