import { NextResponse } from "next/server";

export async function GET() {
    try {
        // Try to import the admin module dynamically to capture initialization errors
        try {
            const getFirebaseAdmin = (await import("@/lib/firebaseAdmin"))
                .default;
            // Call the initializer so it logs its startup and throws on misconfiguration
            const admin = getFirebaseAdmin();

            // Try to read a non-sensitive field like projectId
            const projectId =
                admin?.app()?.options?.projectId ||
                process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
                process.env.FIREBASE_PROJECT_ID ||
                null;

            console.info("[admin/health] firebaseAdmin check", { projectId });

            return NextResponse.json({ ok: true, projectId }, { status: 200 });
        } catch (err: any) {
            console.error(
                "[admin/health] firebaseAdmin import/init error:",
                err
            );
            // Return a helpful, non-sensitive diagnostic code
            return NextResponse.json(
                {
                    ok: false,
                    error: "admin_not_configured",
                    message:
                        "Unable to initialize Firebase Admin. Check GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_ADMIN_CREDENTIALS in your environment.",
                },
                { status: 200 }
            );
        }
    } catch (err: any) {
        console.error("[admin/health] unexpected error:", err);
        return NextResponse.json(
            { ok: false, error: "internal_error" },
            { status: 500 }
        );
    }
}
