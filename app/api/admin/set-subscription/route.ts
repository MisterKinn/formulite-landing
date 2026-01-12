export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";

// Initialize admin SDK once. Support either Application Default or
// a base64-encoded service account JSON in FIREBASE_ADMIN_CREDENTIALS env var.
if (!admin.apps.length) {
    if (process.env.FIREBASE_ADMIN_CREDENTIALS) {
        try {
            const creds = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);
            admin.initializeApp({ credential: admin.credential.cert(creds) });
        } catch (err) {
            console.error("Failed to parse FIREBASE_ADMIN_CREDENTIALS", err);
            admin.initializeApp();
        }
    } else {
        admin.initializeApp();
    }
}

const db = admin.firestore();

export async function POST(request: NextRequest) {
    const secret = request.headers.get("x-admin-secret");
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { userId, subscription } = body;
        if (!userId || !subscription) {
            return NextResponse.json(
                { error: "Missing parameters" },
                { status: 400 }
            );
        }

        await db
            .collection("users")
            .doc(userId)
            .set({ subscription }, { merge: true });

        return NextResponse.json({ success: true, userId, subscription });
    } catch (err) {
        console.error("/api/admin/set-subscription error", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
