import { NextResponse } from "next/server";
import { sendPasswordChangedNotification } from "@/lib/email";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const email: string | undefined = body?.email;
        if (!email) {
            return NextResponse.json(
                { ok: false, error: "missing email" },
                { status: 400 }
            );
        }

        await sendPasswordChangedNotification(email);
        return NextResponse.json({ ok: true }, { status: 200 });
    } catch (err: any) {
        const code = err?.code || err?.message || String(err || "");
        const errText = String(code).toLowerCase();
        if (
            errText.includes("unable to detect a project id") ||
            errText.includes("could not load the default credentials") ||
            errText.includes("project id")
        ) {
            console.error(
                "[password-changed] Firebase Admin misconfigured — check GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_ADMIN_CREDENTIALS",
                err
            );
            return NextResponse.json(
                { ok: false, error: "server_misconfigured" },
                { status: 500 }
            );
        }

        console.error("[password-changed] error:", err);
        return NextResponse.json(
            { ok: false, error: "internal_server_error" },
            { status: 500 }
        );
    }
}
