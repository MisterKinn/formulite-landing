import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { ADMIN_EMAIL } from "@/lib/adminPortal";
import { normalizePlanLike } from "@/lib/userData";

const SINGLE_DEVICE_PLANS = new Set(["free", "plus", "test"]);

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const uid = String(body?.uid || "").trim();
        const desktopSessionId = String(body?.desktopSessionId || "").trim();
        const normalizedPlan = normalizePlanLike(body?.plan || body?.tier || "free");
        const email = String(body?.email || "")
            .trim()
            .toLowerCase();

        if (!uid || !desktopSessionId) {
            return NextResponse.json(
                { success: false, error: "uid and desktopSessionId are required" },
                { status: 400 },
            );
        }

        const isAdmin = email === ADMIN_EMAIL;
        const enforceSingleDevice = !isAdmin && SINGLE_DEVICE_PLANS.has(normalizedPlan);
        if (!enforceSingleDevice) {
            return NextResponse.json({
                success: true,
                enforced: false,
                plan: normalizedPlan,
                isAdmin,
            });
        }

        const admin = getFirebaseAdmin();
        const db = admin.firestore();
        const userRef = db.collection("users").doc(uid);

        await userRef.set(
            {
                desktopSessionId,
                desktopSessionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );

        return NextResponse.json({
            success: true,
            enforced: true,
            plan: normalizedPlan,
            isAdmin,
        });
    } catch (error) {
        console.error("desktop-activate error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to activate desktop session" },
            { status: 500 },
        );
    }
}
