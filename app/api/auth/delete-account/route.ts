export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

function getBearerToken(authHeader: string | null): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }
    return authHeader.slice("Bearer ".length).trim() || null;
}

export async function POST(request: NextRequest) {
    try {
        const token = getBearerToken(request.headers.get("Authorization"));
        if (!token) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const admin = getFirebaseAdmin();
        const decoded = await admin.auth().verifyIdToken(token);
        const uid = String(decoded.uid || "").trim();
        if (!uid) {
            return NextResponse.json(
                { error: "Invalid user token" },
                { status: 401 },
            );
        }

        const db = admin.firestore();
        const userDocRef = db.collection("users").doc(uid);

        // Remove user-owned Firestore data first (including subcollections).
        try {
            await db.recursiveDelete(userDocRef);
        } catch (err) {
            console.warn("[auth/delete-account] recursiveDelete failed:", err);
            await userDocRef.delete().catch(() => undefined);
        }

        // Finally remove Firebase Authentication account.
        await admin.auth().deleteUser(uid);

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error("[auth/delete-account] failed:", error);
        const message =
            error instanceof Error ? error.message : String(error || "");
        if (message.includes("Firebase Admin initialization failed")) {
            return NextResponse.json(
                {
                    error: "server_misconfigured",
                    message:
                        "서버 Firebase Admin 설정이 누락되어 계정 삭제를 진행할 수 없습니다.",
                },
                { status: 500 },
            );
        }
        return NextResponse.json(
            {
                error: "delete_account_failed",
                message: "계정 삭제 처리 중 오류가 발생했습니다.",
            },
            { status: 500 },
        );
    }
}
