import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

// Poll endpoint for Python app to get user info after login
export async function GET(request: NextRequest) {
    try {
        const sessionId = request.nextUrl.searchParams.get("session");

        console.log("📥 GET /api/auth/get-session - Session ID:", sessionId);

        if (!sessionId) {
            const response = { error: "Session ID required" };
            console.log("❌ Response:", response);
            return NextResponse.json(response, { status: 400 });
        }

        const admin = getFirebaseAdmin();
        const db = admin.firestore();

        const sessionDoc = await db
            .collection("oauth_sessions")
            .doc(sessionId)
            .get();

        if (!sessionDoc.exists) {
            const response = { error: "Session not found" };
            console.log("❌ Response:", response);
            return NextResponse.json(response, { status: 404 });
        }

        const sessionData = sessionDoc.data();

        if (!sessionData) {
            const response = { error: "Session data not found" };
            console.log("❌ Response:", response);
            return NextResponse.json(response, { status: 404 });
        }

        console.log("📊 Session data:", {
            status: sessionData.status,
            expiresAt: new Date(sessionData.expiresAt).toISOString(),
            hasUserData: !!sessionData.uid,
        });

        // Check if expired
        if (sessionData.expiresAt < Date.now()) {
            await db.collection("oauth_sessions").doc(sessionId).delete();
            const response = { error: "Session expired" };
            console.log("⏰ Response:", response);
            return NextResponse.json(response, { status: 410 });
        }

        // If still pending, return pending status
        if (sessionData.status === "pending") {
            const response = {
                status: "pending",
                message: "Waiting for user to complete login",
            };
            console.log("⏳ Response:", response);
            return NextResponse.json(response);
        }

        // If completed, return user info and delete session
        if (sessionData.status === "completed") {
            const userInfo = {
                uid: sessionData.uid,
                email: sessionData.email,
                name: sessionData.name,
                photoUrl: sessionData.photoUrl,
                tier: sessionData.tier || sessionData.plan || "free",
                plan: sessionData.plan || sessionData.tier || "free",
            };

            // Delete session after retrieval (one-time use)
            await db.collection("oauth_sessions").doc(sessionId).delete();

            const response = {
                status: "completed",
                user: userInfo,
            };
            console.log("✅ Response (sending to program):", response);
            return NextResponse.json(response);
        }

        const response = { error: "Invalid session status" };
        console.log("❌ Response:", response);
        return NextResponse.json(response, { status: 500 });
    } catch (error) {
        console.error("Error getting session:", error);
        return NextResponse.json(
            { error: "Failed to get session" },
            { status: 500 }
        );
    }
}
