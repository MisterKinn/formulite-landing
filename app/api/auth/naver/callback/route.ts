import { NextResponse } from "next/server";
// Lazily import the firebase-admin initializer to avoid throwing during cold-start when creds are not available.
import getFirebaseAdmin from "@/lib/firebaseAdmin";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const params = url.searchParams;
    const code = params.get("code");
    const state = params.get("state");

    const rawCookies = req.headers.get("cookie") || "";
    const cookieState = rawCookies?.match(/oauth_state=([^;]+)/)?.[1];
    const returnTo = rawCookies?.match(/oauth_return_to=([^;]+)/)?.[1] || "";

    // Debug logs to help diagnose mismatches. In production, keep logs minimal.
    try {
        console.info("[/api/auth/naver/callback] incoming code/state", {
            code,
            state,
        });
        console.info(
            "[/api/auth/naver/callback] cookie header present:",
            Boolean(rawCookies),
        );
        console.info("[/api/auth/naver/callback] cookieState", cookieState);
    } catch (e) {}

    if (!code) {
        return new NextResponse("Missing code", { status: 400 });
    }

    if (!state || !cookieState || state !== cookieState) {
        console.warn("[/api/auth/naver/callback] state mismatch", {
            state,
            cookieState,
        });

        // If no server-side state was stored (cookieState missing), fall back to client-side exchange.
        // Render a small page that posts the code and state back to the opener window so the client can
        // verify the state against localStorage and call /api/auth/naver/exchange.
        const fallbackHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Completing sign-in</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial;background:#f7f8fa;color:#111;display:flex;align-items:center;justify-content:center;height:100vh}
    .card{background:#fff;padding:28px;border-radius:12px;box-shadow:0 8px 30px rgba(2,6,23,.08);max-width:640px;text-align:center}
    .emoji{font-size:36px}
    h1{margin:12px 0;font-size:18px}
    p.message{color:#374151;margin:8px 0}
    .note{color:#6b7280;font-size:13px;margin-top:10px}
    .btn{display:inline-block;margin-top:14px;padding:8px 14px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;border:none;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">🔁</div>
    <h1>Completing sign-in</h1>
    <p class="message">You can close this window.</p>
    <p class="note">This window will attempt to close automatically. If it doesn’t, you can close it manually.</p>
    <button class="btn" onclick="window.close()">Close window</button>
    <p style="margin-top:12px;font-size:12px;color:#6b7280">Served by <strong>/api/auth/naver/callback (fallback)</strong></p>
  </div>
  <script>
      try {
        const data = { type: 'oauth-code', provider: 'naver', code: ${JSON.stringify(
            code,
        )}, state: ${JSON.stringify(state)}, returnTo: ${JSON.stringify(
            returnTo,
        )} };
        const target = window.opener?.location?.origin || '*';
        window.opener && window.opener.postMessage(data, target);
      } catch(e){ console.error(e); }
      window.close();
    </script>
</body>
</html>`;
        const resFallback = new NextResponse(fallbackHtml, {
            headers: { "Content-Type": "text/html" },
        });
        // clear any stale cookies
        resFallback.cookies.set({ name: "oauth_state", value: "", maxAge: 0 });
        resFallback.cookies.set({
            name: "oauth_return_to",
            value: "",
            maxAge: 0,
        });
        return resFallback;
    }

    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    // redirect_uri must match exactly what was sent in the authorize request (no www for Naver)
    const redirectUri =
        process.env.NAVER_REDIRECT_URI ||
        "https://nova-ai.work/api/auth/naver/callback";

    // Exchange code for access token as per Naver Node.js example:
    // https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=...&client_secret=...&redirect_uri=...&code=...&state=...
    const tokenUrl = `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${encodeURIComponent(
        clientId || "",
    )}&client_secret=${encodeURIComponent(
        clientSecret || "",
    )}&redirect_uri=${encodeURIComponent(
        redirectUri,
    )}&code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

    console.info(
        "[/api/auth/naver/callback] tokenUrl:",
        tokenUrl.replace(clientSecret || "", "***"),
    );

    const tokenResp = await fetch(tokenUrl, {
        method: "GET",
        headers: {
            "X-Naver-Client-Id": clientId || "",
            "X-Naver-Client-Secret": clientSecret || "",
        },
    });

    if (!tokenResp.ok) {
        const txt = await tokenResp.text();
        console.error("NAVER token exchange failed", txt);
        return new NextResponse("Token exchange failed", { status: 500 });
    }

    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
        console.error("NAVER token response missing access_token", tokenJson);
        return new NextResponse("Missing access token", { status: 500 });
    }

    // Fetch user profile
    const profileResp = await fetch("https://openapi.naver.com/v1/nid/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileResp.ok) {
        const txt = await profileResp.text();
        console.error("NAVER profile fetch failed", txt);
        return new NextResponse("Failed to fetch profile", { status: 500 });
    }

    const profile = await profileResp.json();
    const naverId = profile?.response?.id;
    const email = profile?.response?.email;
    const name = profile?.response?.name || profile?.response?.nickname || "";

    if (!naverId) {
        console.error("NAVER profile missing id", profile);
        return new NextResponse("Invalid profile", { status: 500 });
    }

    // Create Firebase custom token using uid prefix to avoid collisions
    const uid = `naver:${naverId}`;

    try {
        // Lazily initialize firebase-admin and create a custom token for the provider user.
        const admin = getFirebaseAdmin();
        const customToken = await admin
            .auth()
            .createCustomToken(uid, { provider: "naver", email, name });

        // Persist profile to Firestore so client can read email/name right away
        try {
            const db = admin.firestore();
            await db
                .collection("users")
                .doc(uid)
                .set(
                    {
                        avatar: profile?.response?.profile_image || null,
                        displayName:
                            profile?.response?.name ||
                            profile?.response?.nickname ||
                            null,
                        email: profile?.response?.email || null,
                        createdAt: Date.now(),
                    },
                    { merge: true },
                );
        } catch (err: any) {
            console.warn(
                "[NAVER callback] Failed to persist profile to Firestore",
                err?.message || err,
            );
        }

        // Render a small page that posts the custom token back to the opener and closes
        const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Signing in</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial;background:#f7f8fa;color:#111;display:flex;align-items:center;justify-content:center;height:100vh}
    .card{background:#fff;padding:28px;border-radius:12px;box-shadow:0 8px 30px rgba(2,6,23,.08);max-width:640px;text-align:center}
    .emoji{font-size:36px}
    h1{margin:12px 0;font-size:18px}
    p.message{color:#374151;margin:8px 0}
    .note{color:#6b7280;font-size:13px;margin-top:10px}
    .btn{display:inline-block;margin-top:14px;padding:8px 14px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;border:none;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">✅</div>
    <h1>Signing in</h1>
    <p class="message">Signing in... You can close this window.</p>
    <p class="note">This window will attempt to close automatically. If it doesn’t, you can close it manually.</p>
    <button class="btn" onclick="window.close()">Close window</button>
    <p style="margin-top:12px;font-size:12px;color:#6b7280">Served by <strong>/api/auth/naver/callback</strong></p>
  </div>
  <script>
      try {
        const data = { type: 'oauth', provider: 'naver', customToken: ${JSON.stringify(
            customToken,
        )}, profile: ${JSON.stringify(profile.response)} };
        const target = ${
            returnTo
                ? JSON.stringify(returnTo)
                : "window.opener?.location?.origin || '*'"
        };
        window.opener && window.opener.postMessage(data, target);
      } catch(e){ console.error(e); }
      window.close();
    </script>
</body>
</html>`;

        const res = new NextResponse(html, {
            headers: { "Content-Type": "text/html" },
        });
        // clear state cookies
        res.cookies.set({ name: "oauth_state", value: "", maxAge: 0 });
        res.cookies.set({ name: "oauth_return_to", value: "", maxAge: 0 });
        return res;
    } catch (err: any) {
        console.error("Failed to create custom token", err);
        // If the admin SDK failed to load credentials, return a helpful HTML page with developer instructions (safe for dev only)
        const msg = String(err?.message || err);
        const isCredErr =
            msg.toLowerCase().includes("credentials") ||
            msg.toLowerCase().includes("default credentials");

        const debugHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Configuration error</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial;background:#111;color:#e6eef8;padding:24px}
    .container{max-width:880px;margin:40px auto;background:#0b1220;padding:22px;border-radius:10px;border:1px solid rgba(255,255,255,0.04)}
    h2{margin-top:0;color:#fff}
    pre{background:#000;padding:12px;border-radius:6px;white-space:pre-wrap;color:#f88;overflow:auto}
    .muted{color:#9aa4b2}
    button.copy{background:#2563eb;border:none;color:#fff;padding:8px 12px;border-radius:8px;cursor:pointer}
  </style>
</head>
<body>
  <div class="container">
    <h2>Firebase Admin not configured</h2>
    <p class="muted">The server could not initialize <code>firebase-admin</code> to mint custom tokens.</p>
    <pre>${String(msg)}</pre>
    <p class="muted">To fix this, set <code>FIREBASE_ADMIN_CREDENTIALS</code> (JSON string) or <code>GOOGLE_APPLICATION_CREDENTIALS</code> (path to JSON), or the base64 variant <code>FIREBASE_ADMIN_CREDENTIALS_B64</code>.</p>
    <p class="muted">You can also verify from your machine by visiting the protected debug endpoint:</p>
    <pre>GET ${
        new URL(req.url).origin
    }/api/debug/firebase-admin?admin_secret=YOUR_ADMIN_SECRET</pre>
    <h3>Profile</h3>
    <pre>${JSON.stringify(profile, null, 2)}</pre>
    <p><button class="copy" id="copy">Copy profile JSON</button></p>
    <script>
      document.getElementById('copy')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(${JSON.stringify(
            profile,
        )}, null, 2)); alert('Copied'); } catch(e) { alert('Copy failed'); }
      });
    </script>
  </div>
</body>
</html>`;

        if (isCredErr) {
            const res = new NextResponse(debugHtml, {
                headers: { "Content-Type": "text/html" },
                status: 500,
            });
            // clear state cookie anyway
            res.cookies.set({ name: "oauth_state", value: "", maxAge: 0 });
            return res;
        }

        return new NextResponse("Server error", { status: 500 });
    }
}
