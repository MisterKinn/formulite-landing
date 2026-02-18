import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { ADMIN_EMAIL } from "@/lib/adminPortal";
import { normalizePlanLike } from "@/lib/userData";

const SINGLE_DEVICE_PLANS = new Set(["free", "plus", "test"]);

export async function GET(request: NextRequest) {
    try {
        const userId = String(request.nextUrl.searchParams.get("userId") || "").trim();
        const desktopSessionId = String(
            request.nextUrl.searchParams.get("desktopSessionId") || "",
        ).trim();

        if (!userId || !desktopSessionId) {
            return NextResponse.json(
                { active: true, enforceSingleDevice: false, reason: "missing_params" },
                { status: 400 },
            );
        }

        const admin = getFirebaseAdmin();
        const db = admin.firestore();
        const userSnap = await db.collection("users").doc(userId).get();
        const userData = userSnap.exists ? userSnap.data() || {} : {};

        const email = String(userData.email || "")
            .trim()
            .toLowerCase();
        const plan = normalizePlanLike(
            userData.plan || userData.tier || userData.subscription?.plan || "free",
        );
        const isAdmin = email === ADMIN_EMAIL;
        const enforceSingleDevice = !isAdmin && SINGLE_DEVICE_PLANS.has(plan);

        if (!enforceSingleDevice) {
            return NextResponse.json({
                active: true,
                enforceSingleDevice: false,
                plan,
                isAdmin,
            });
        }

        const activeDesktopSessionId = String(userData.desktopSessionId || "").trim();
        const isActive =
            !activeDesktopSessionId || activeDesktopSessionId === desktopSessionId;

        return NextResponse.json({
            active: isActive,
            enforceSingleDevice: true,
            plan,
            isAdmin,
            reason: isActive ? "ok" : "replaced_by_other_device",
        });
    } catch (error) {
        console.error("desktop-session-status error:", error);
        return NextResponse.json(
            { active: true, enforceSingleDevice: false, reason: "server_error" },
            { status: 500 },
        );
    }
}
