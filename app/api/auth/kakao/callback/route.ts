import { NextResponse } from "next/server";
import initAdmin from "@/lib/firebaseAdmin";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const params = url.searchParams;
    const code = params.get("code");
    const state = params.get("state");

    const cookieState = req.headers
        .get("cookie")
        ?.match(/oauth_state=([^;]+)/)?.[1];
    const returnTo =
        req.headers.get("cookie")?.match(/oauth_return_to=([^;]+)/)?.[1] || "";

    if (!code) return new NextResponse("Missing code", { status: 400 });
    if (!state || !cookieState || state !== cookieState) {
        console.warn("[/api/auth/kakao/callback] state mismatch", {
            state,
            cookieState,
        });
        // Fallback to client-side exchange when server cookie state is missing (same as Naver).
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
  </div>
  <script>
      try {
        const data = { type: 'oauth-code', provider: 'kakao', code: ${JSON.stringify(
            code
        )}, state: ${JSON.stringify(state)}, returnTo: ${JSON.stringify(
            returnTo
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
        resFallback.cookies.set({ name: "oauth_state", value: "", maxAge: 0 });
        resFallback.cookies.set({
            name: "oauth_return_to",
            value: "",
            maxAge: 0,
        });
        return resFallback;
    }

    const clientId =
        process.env.KAKAO_CLIENT_ID || process.env.KAKAO_REST_API_KEY;
    const clientSecret = process.env.KAKAO_CLIENT_SECRET || "";

    // Build token request and omit client_secret when not set
    const tokenParams = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId || "",
        redirect_uri: `${url.origin}/api/auth/kakao/callback`,
        code,
    });
    if (clientSecret) tokenParams.set("client_secret", clientSecret);

    const tokenResp = await fetch("https://kauth.kakao.com/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: tokenParams.toString(),
    });

    if (!tokenResp.ok) {
        const txt = await tokenResp.text();
        console.error("KAKAO token exchange failed", txt);
        if (process.env.NODE_ENV !== "production") {
            return new NextResponse(`Token exchange failed: ${txt}`, {
                status: 500,
            });
        }
        return new NextResponse("Token exchange failed", { status: 500 });
    }

    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken)
        return new NextResponse("Missing access token", { status: 500 });

    // Fetch user profile
    const profileResp = await fetch("https://kapi.kakao.com/v2/user/me", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });

    if (!profileResp.ok) {
        const txt = await profileResp.text();
        console.error("KAKAO profile fetch failed", txt);
        return new NextResponse("Failed to fetch profile", { status: 500 });
    }

    const profile = await profileResp.json();
    const kakaoId = profile?.id;
    const kakaoAccount = profile?.kakao_account || {};
    const email = kakaoAccount?.email;
    const name = kakaoAccount?.profile?.nickname || "";

    if (!kakaoId) {
        console.error("KAKAO profile missing id", profile);
        return new NextResponse("Invalid profile", { status: 500 });
    }

    const uid = `kakao:${kakaoId}`;

    try {
        const admin = initAdmin();
        const customToken = await admin
            .auth()
            .createCustomToken(uid, { provider: "kakao", email, name });

        // Persist profile to Firestore so client can read email/name right away
        try {
            const db = admin.firestore();
            await db
                .collection("users")
                .doc(uid)
                .set(
                    {
                        avatar:
                            kakaoAccount?.profile?.profile_image_url || null,
                        displayName: kakaoAccount?.profile?.nickname || null,
                        email: kakaoAccount?.email || null,
                        createdAt: Date.now(),
                    },
                    { merge: true }
                );
        } catch (err: any) {
            console.warn(
                "[KAKAO callback] Failed to persist profile to Firestore",
                err?.message || err
            );
        }

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
  </div>
  <script>
      try {
        const data = { type: 'oauth', provider: 'kakao', customToken: ${JSON.stringify(
            customToken
        )}, profile: ${JSON.stringify(profile)} };
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
        res.cookies.set({ name: "oauth_state", value: "", maxAge: 0 });
        res.cookies.set({ name: "oauth_return_to", value: "", maxAge: 0 });
        return res;
    } catch (err) {
        console.error("Failed to create custom token", err);
        return new NextResponse("Server error", { status: 500 });
    }
}
