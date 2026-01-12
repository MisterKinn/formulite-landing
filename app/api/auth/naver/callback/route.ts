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

    if (!code) {
        return new NextResponse("Missing code", { status: 400 });
    }

    if (!state || !cookieState || state !== cookieState) {
        return new NextResponse("Invalid state", { status: 400 });
    }

    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    const tokenUrl = "https://nid.naver.com/oauth2.0/token";

    // Exchange code for access token
    const tokenResp = await fetch(
        `${tokenUrl}?grant_type=authorization_code&client_id=${encodeURIComponent(
            clientId || ""
        )}&client_secret=${encodeURIComponent(
            clientSecret || ""
        )}&code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
    );

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
        const admin = initAdmin;
        const customToken = await admin
            .auth()
            .createCustomToken(uid, { provider: "naver", email, name });

        // Render a small page that posts the custom token back to the opener and closes
        const html = `<!doctype html>
<html>
  <body>
    <script>
      try {
        const data = { type: 'oauth', provider: 'naver', customToken: ${JSON.stringify(
            customToken
        )} };
        const target = ${
            returnTo
                ? JSON.stringify(returnTo)
                : "window.opener?.location?.origin || '*'"
        };
        window.opener && window.opener.postMessage(data, target);
      } catch(e){ console.error(e); }
      window.close();
    </script>
    <p>Signing in... You can close this window.</p>
  </body>
</html>`;

        const res = new NextResponse(html, {
            headers: { "Content-Type": "text/html" },
        });
        // clear state cookies
        res.cookies.set({ name: "oauth_state", value: "", maxAge: 0 });
        res.cookies.set({ name: "oauth_return_to", value: "", maxAge: 0 });
        return res;
    } catch (err) {
        console.error("Failed to create custom token", err);
        return new NextResponse("Server error", { status: 500 });
    }
}
