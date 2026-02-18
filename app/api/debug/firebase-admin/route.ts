import { NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

export async function GET(req: Request) {
    try {
        // protect endpoint with ADMIN_SECRET query param or header
        const url = new URL(req.url);
        const provided =
            url.searchParams.get("admin_secret") ||
            req.headers.get("x-admin-secret");
        const adminSecret = process.env.ADMIN_SECRET;

        // Debug info (DO NOT log secrets themselves)
        console.info(
            "[/api/debug/firebase-admin] adminSecret present:",
            Boolean(adminSecret)
        );
        console.info(
            "[/api/debug/firebase-admin] provided secret present:",
            Boolean(provided)
        );
        console.info(
            "[/api/debug/firebase-admin] provided matches configured:",
            adminSecret ? provided === adminSecret : false
        );

        // Support a literal placeholder so example commands like
        // curl ".../api/debug/firebase-admin?admin_secret=$ADMIN_SECRET" work when copying/pasting
        const providedEffective =
            provided === "$ADMIN_SECRET" || provided === "ENV"
                ? adminSecret
                : provided;

        if (!adminSecret || providedEffective !== adminSecret) {
            return new NextResponse(
                "Unauthorized: missing or incorrect admin_secret. Provide ?admin_secret=<YOUR_ADMIN_SECRET> or header x-admin-secret",
                { status: 401 }
            );
        }

        try {
            getFirebaseAdmin();
            return NextResponse.json({
                ok: true,
                message: "Firebase Admin initialized",
            });
        } catch (err: any) {
            return NextResponse.json(
                { ok: false, message: String(err.message || err) },
                { status: 500 }
            );
        }
    } catch (err) {
        console.error("[/api/debug/firebase-admin] error", err);
        return new NextResponse("Server error", { status: 500 });
    }
}
