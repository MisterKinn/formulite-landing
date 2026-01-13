import { NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { sendPasswordResetEmailToUser } from "@/lib/email";

export async function POST(req: Request) {
    // Keep `email` scoped to the outer function so fallback handlers can reference it from the catch block
    let email: string | undefined;

    try {
        const body = await req.json();
        email = body?.email;

        if (!email) {
            // For security, don't reveal whether an account exists — respond with generic success
            return NextResponse.json({ ok: true }, { status: 200 });
        }

        // Action code settings: redirect to our hosted password-reset page after reset
        const baseUrl = (
            process.env.NEXT_PUBLIC_BASE_URL ||
            process.env.NEXT_PUBLIC_APP_URL ||
            process.env.BASE_URL ||
            "http://localhost:3000"
        ).replace(/\/$/, "");

        const actionCodeSettings = {
            url: `${baseUrl}/password-reset`,
            // We handle the action code inside our app (we'll read oobCode and mode from the query)
            handleCodeInApp: true,
        } as any;

        // Generate a Firebase password reset link using Admin SDK
        const admin = getFirebaseAdmin();
        const link = await admin
            .auth()
            .generatePasswordResetLink(email, actionCodeSettings);

        // Prefer to send a link that points directly to our site (so users don't first land on firebaseapp.com)
        try {
            const parsed = new URL(link);
            const params = parsed.searchParams;
            const oobCode = params.get("oobCode");
            const apiKey =
                params.get("apiKey") ||
                process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
            const mode = params.get("mode") || "resetPassword";
            const lang = params.get("lang") || "en";

            if (oobCode) {
                const appResetLink = `${baseUrl}/password-reset?mode=${encodeURIComponent(
                    mode
                )}&oobCode=${encodeURIComponent(
                    oobCode
                )}&apiKey=${encodeURIComponent(
                    apiKey || ""
                )}&lang=${encodeURIComponent(lang)}`;

                await sendPasswordResetEmailToUser(email!, appResetLink);
                console.info("[password-reset] sent app-hosted reset link", {
                    appResetLink,
                });
                return NextResponse.json({ ok: true }, { status: 200 });
            }
        } catch (parseErr) {
            console.warn(
                "[password-reset] failed to parse firebase link, falling back to original link",
                parseErr
            );
        }

        // Fallback: Send the original Firebase-hosted link if we couldn't construct an app link
        await sendPasswordResetEmailToUser(email!, link);

        return NextResponse.json({ ok: true }, { status: 200 });
    } catch (err: any) {
        // If user doesn't exist, keep response generic for security
        const code = err?.code || err?.message || String(err || "");
        if (String(code).toLowerCase().includes("user-not-found")) {
            console.warn("[password-reset] user not found:", code);
            return NextResponse.json({ ok: true }, { status: 200 });
        }

        // Detect Firebase Admin / credentials related errors and return a specific, non-sensitive code
        const errText = String(code).toLowerCase();
        if (
            errText.includes("unable to detect a project id") ||
            errText.includes("could not load the default credentials") ||
            errText.includes("project id")
        ) {
            console.error(
                "[password-reset] Firebase Admin misconfigured — check GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_ADMIN_CREDENTIALS",
                err
            );

            // write a small admin diagnostic file to tmp so developer can inspect details
            try {
                const fs = await import("fs");
                const os = await import("os");
                const path = await import("path");
                const tmpDir = path.resolve(os.tmpdir());
                const logFile = path.join(tmpDir, "formulite-admin-errors.log");
                const entry = {
                    time: new Date().toISOString(),
                    context: "password-reset",
                    message: err?.message || null,
                    stack: err?.stack || null,
                    env: {
                        NEXT_PUBLIC_BASE_URL:
                            process.env.NEXT_PUBLIC_BASE_URL || null,
                        NEXT_PUBLIC_FIREBASE_PROJECT_ID:
                            process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
                    },
                };
                fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
                console.info(
                    "[password-reset] admin diagnostic written to",
                    logFile
                );
            } catch (logErr) {
                console.warn(
                    "[password-reset] failed to write admin diagnostic log",
                    logErr
                );
            }

            // Attempt a server-side fallback using Firebase Identity Toolkit REST API (uses the web API key)
            try {
                let apiKey =
                    process.env.FIREBASE_API_KEY ||
                    process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

                // Development helper: if API key not present in process env, try to read from project .env.local (local dev only)
                if (!apiKey) {
                    try {
                        const fs = await import("fs");
                        const path = await import("path");
                        const envPath = path.resolve(
                            process.cwd(),
                            ".env.local"
                        );
                        if (fs.existsSync(envPath)) {
                            const content = fs.readFileSync(envPath, "utf8");
                            const m = content.match(
                                /NEXT_PUBLIC_FIREBASE_API_KEY\s*=\s*"?([^\n\r"]+)"?/
                            );
                            if (m && m[1]) {
                                apiKey = m[1].trim();
                                console.info(
                                    "[password-reset] read NEXT_PUBLIC_FIREBASE_API_KEY from .env.local"
                                );
                            }
                        }
                    } catch (readErr) {
                        console.warn(
                            "[password-reset] failed to read .env.local for API key",
                            readErr
                        );
                    }
                }

                // Write an entry that indicates whether we have an API key and will attempt fallback
                try {
                    const fs = await import("fs");
                    const os = await import("os");
                    const path = await import("path");
                    const tmpDir = path.resolve(os.tmpdir());
                    const logFile = path.join(
                        tmpDir,
                        "formulite-password-reset-errors.log"
                    );
                    const entry = {
                        time: new Date().toISOString(),
                        fallbackCandidate: !!apiKey,
                    };
                    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
                    console.info(
                        "[password-reset] recorded fallbackCandidate to",
                        logFile
                    );
                } catch (logErr) {
                    console.warn(
                        "[password-reset] could not write fallbackCandidate",
                        logErr
                    );
                }

                if (apiKey) {
                    const safeEmail = String(email || "");
                    const resp = await fetch(
                        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(
                            apiKey
                        )}`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                requestType: "PASSWORD_RESET",
                                email: safeEmail,
                            }),
                        }
                    );

                    console.info(
                        "[password-reset] identity toolkit response status",
                        { status: resp.status }
                    );

                    if (resp.ok) {
                        console.info(
                            "[password-reset] fallback via Identity Toolkit succeeded",
                            { email }
                        );
                        return NextResponse.json({ ok: true }, { status: 200 });
                    }

                    // capture body for logging
                    let ft = "";
                    try {
                        ft = await resp.text();
                    } catch (e) {}
                    console.error(
                        "[password-reset] identity toolkit fallback failed",
                        { status: resp.status, body: ft }
                    );

                    // Persist the fallback failure to the password-reset diagnostic log for easier debugging
                    try {
                        const fs = await import("fs");
                        const os = await import("os");
                        const path = await import("path");
                        const tmpDir = path.resolve(os.tmpdir());
                        const logFile = path.join(
                            tmpDir,
                            "formulite-password-reset-errors.log"
                        );
                        const entry = {
                            eventId: `pr_${Date.now().toString(
                                36
                            )}_${Math.random().toString(36).slice(2, 8)}`,
                            time: new Date().toISOString(),
                            fallback: "identity_toolkit",
                            status: resp.status,
                            body: ft,
                        };
                        fs.appendFileSync(
                            logFile,
                            JSON.stringify(entry) + "\n"
                        );
                        console.info(
                            "[password-reset] fallback diagnostic written to",
                            logFile
                        );
                    } catch (logErr) {
                        console.warn(
                            "[password-reset] failed to write fallback diagnostic log",
                            logErr
                        );
                    }
                } else {
                    console.warn(
                        "[password-reset] no Firebase API key available for fallback"
                    );
                }
            } catch (fallbackErr: any) {
                console.error(
                    "[password-reset] fallback attempt threw an error",
                    fallbackErr
                );
                try {
                    const fs = await import("fs");
                    const os = await import("os");
                    const path = await import("path");
                    const tmpDir = path.resolve(os.tmpdir());
                    const logFile = path.join(
                        tmpDir,
                        "formulite-password-reset-errors.log"
                    );
                    const entry = {
                        eventId: `pr_${Date.now().toString(36)}_${Math.random()
                            .toString(36)
                            .slice(2, 8)}`,
                        time: new Date().toISOString(),
                        fallback: "identity_toolkit_exception",
                        message: fallbackErr?.message || String(fallbackErr),
                        stack: fallbackErr?.stack || null,
                    };
                    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
                    console.info(
                        "[password-reset] fallback exception diagnostic written to",
                        logFile
                    );
                } catch (logErr) {
                    console.warn(
                        "[password-reset] failed to write fallback exception log",
                        logErr
                    );
                }
            }

            return NextResponse.json(
                { ok: false, error: "server_misconfigured" },
                { status: 500 }
            );
        }

        // For other failures, log a short event id to correlate with server logs and return a safe code
        const eventId = `pr_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;
        console.error("[password-reset] generatePasswordResetLink failed", {
            eventId,
            error: err,
        });

        // Persist a short server-side diagnostic entry (local dev only) so the developer can inspect details
        try {
            const fs = await import("fs");
            const os = await import("os");
            const path = await import("path");
            const tmpDir = path.resolve(os.tmpdir());
            const logFile = path.join(
                tmpDir,
                "formulite-password-reset-errors.log"
            );
            const entry = {
                eventId,
                time: new Date().toISOString(),
                code: code || null,
                message: err?.message || null,
                stack: err?.stack || null,
            };
            fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
            console.info("[password-reset] diagnostic written to", logFile);
        } catch (logErr) {
            console.warn(
                "[password-reset] failed to write diagnostic log",
                logErr
            );
        }

        // If the error is due to an unauthorized continue URL (not allowlisted in Firebase Console),
        // try a best-effort approach:
        // 1) Attempt to generate a reset link without actionCodeSettings (use project default)
        // 2) If that fails, attempt Identity Toolkit REST fallback
        try {
            if (
                String(code).toLowerCase().includes("unauthorized-continue-uri")
            ) {
                try {
                    const admin = getFirebaseAdmin();
                    const link = await admin
                        .auth()
                        .generatePasswordResetLink(email!);
                    await sendPasswordResetEmailToUser(email!, link);
                    console.info(
                        "[password-reset] successful generatePasswordResetLink() without continue URL",
                        { email }
                    );
                    return NextResponse.json({ ok: true }, { status: 200 });
                } catch (retryErr) {
                    console.warn(
                        "[password-reset] generatePasswordResetLink without continue URL failed",
                        retryErr
                    );
                }

                const apiKey =
                    process.env.FIREBASE_API_KEY ||
                    process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
                if (apiKey) {
                    console.info(
                        "[password-reset] attempting Identity Toolkit fallback",
                        {
                            keyPresent: true,
                            apiKeyPrefix: String(apiKey).slice(0, 6),
                        }
                    );
                    const safeEmail = String(email || "");
                    const resp = await fetch(
                        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(
                            apiKey
                        )}`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                requestType: "PASSWORD_RESET",
                                email: safeEmail,
                            }),
                        }
                    );
                    const bodyText = await resp.text().catch(() => "");
                    console.info("[password-reset] identity toolkit response", {
                        status: resp.status,
                        bodySample: bodyText.slice(0, 200),
                    });
                    if (resp.ok) {
                        console.info(
                            "[password-reset] fallback via Identity Toolkit succeeded for unauthorized-continue-uri",
                            { email }
                        );
                        return NextResponse.json({ ok: true }, { status: 200 });
                    } else {
                        console.error(
                            "[password-reset] identity toolkit fallback failed",
                            { status: resp.status, body: bodyText }
                        );
                    }
                } else {
                    console.info(
                        "[password-reset] Identity Toolkit fallback skipped, no apiKey"
                    );
                }
            }
        } catch (fallbackErr: any) {
            console.error(
                "[password-reset] identity-toolkit fallback after unauthorized-continue-uri failed",
                fallbackErr
            );
        }

        return NextResponse.json(
            { ok: false, error: "generate_link_failed", eventId },
            { status: 500 }
        );
    }
}
