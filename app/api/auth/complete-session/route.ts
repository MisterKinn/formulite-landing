import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { normalizePlanLike } from "@/lib/userData";

// Complete OAuth session with user info
export async function POST(request: NextRequest) {
    try {
        const { sessionId, uid, name, email, photoUrl, tier, plan } =
            await request.json();

        console.log("Completing session:", { sessionId, uid, email });

        if (!sessionId || !uid) {
            console.error("Missing required fields:", { sessionId, uid });
            return NextResponse.json(
                { error: "Session ID and user ID required" },
                { status: 400 }
            );
        }

        const admin = getFirebaseAdmin();
        const db = admin.firestore();

        const sessionDoc = await db
            .collection("oauth_sessions")
            .doc(sessionId)
            .get();

        if (!sessionDoc.exists) {
            console.error("Session not found:", sessionId);
            return NextResponse.json(
                { error: "Session not found" },
                { status: 404 }
            );
        }

        const sessionData = sessionDoc.data();

        if (!sessionData) {
            console.error("Session data not found:", sessionId);
            return NextResponse.json(
                { error: "Session data not found" },
                { status: 404 }
            );
        }

        // Check if expired
        if (sessionData.expiresAt < Date.now()) {
            console.error("Session expired:", sessionId);
            await db.collection("oauth_sessions").doc(sessionId).delete();
            return NextResponse.json(
                { error: "Session expired" },
                { status: 410 }
            );
        }

        const normalizedPlan = normalizePlanLike(plan || tier || "free", "free");

        // Update session with user info
        await db
            .collection("oauth_sessions")
            .doc(sessionId)
            .update({
                status: "completed",
                uid,
                name: name || null,
                email: email || null,
                photoUrl: photoUrl || null,
                tier: normalizedPlan,
                plan: normalizedPlan,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

        console.log("Session completed successfully:", sessionId);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error completing session:", error);
        return NextResponse.json(
            { error: "Failed to complete session" },
            { status: 500 }
        );
    }
}
