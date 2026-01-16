import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

// Poll endpoint for Python app to get user info after login
export async function GET(request: NextRequest) {
    try {
        const sessionId = request.nextUrl.searchParams.get("session");

        if (!sessionId) {
            return NextResponse.json(
                { error: "Session ID required" },
                { status: 400 }
            );
        }

        const admin = getFirebaseAdmin();
        const db = admin.firestore();

        const sessionDoc = await db.collection("oauth_sessions").doc(sessionId).get();

        if (!sessionDoc.exists) {
            return NextResponse.json(
                { error: "Session not found" },
                { status: 404 }
            );
        }

        const sessionData = sessionDoc.data();

        if (!sessionData) {
            return NextResponse.json(
                { error: "Session data not found" },
                { status: 404 }
            );
        }

        // Check if expired
        if (sessionData.expiresAt < Date.now()) {
            await db.collection("oauth_sessions").doc(sessionId).delete();
            return NextResponse.json(
                { error: "Session expired" },
                { status: 410 }
            );
        }

        // If still pending, return pending status
        if (sessionData.status === "pending") {
            return NextResponse.json({
                status: "pending",
                message: "Waiting for user to complete login",
            });
        }

        // If completed, return user info and delete session
        if (sessionData.status === "completed") {
            const userInfo = {
                uid: sessionData.uid,
                email: sessionData.email,
                name: sessionData.name,
                photoUrl: sessionData.photoUrl,
                tier: sessionData.tier,
            };

            // Delete session after retrieval (one-time use)
            await db.collection("oauth_sessions").doc(sessionId).delete();

            return NextResponse.json({
                status: "completed",
                user: userInfo,
            });
        }

        return NextResponse.json(
            { error: "Invalid session status" },
            { status: 500 }
        );
    } catch (error) {
        console.error("Error getting session:", error);
        return NextResponse.json(
            { error: "Failed to get session" },
            { status: 500 }
        );
    }
}
