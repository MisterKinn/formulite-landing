export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { buildUserRootPatch } from "@/lib/userData";

const admin = getFirebaseAdmin();

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

        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        const normalizedPlan =
            typeof subscription?.plan === "string"
                ? subscription.plan.trim().toLowerCase()
                : undefined;
        const plan =
            normalizedPlan === "free" ||
            normalizedPlan === "go" ||
            normalizedPlan === "plus" ||
            normalizedPlan === "pro" ||
            normalizedPlan === "test"
                ? normalizedPlan
                : undefined;

        await userRef.set(
            buildUserRootPatch({
                existingUser: (userDoc.data() || {}) as Record<string, unknown>,
                subscription,
                plan,
            }),
            { merge: true },
        );

        return NextResponse.json({ success: true, userId, subscription });
    } catch (err) {
        console.error("/api/admin/set-subscription error", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
