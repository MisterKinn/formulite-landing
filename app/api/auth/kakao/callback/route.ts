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
    if (!state || !cookieState || state !== cookieState)
        return new NextResponse("Invalid state", { status: 400 });

    const clientId = process.env.KAKAO_CLIENT_ID;
    const clientSecret = process.env.KAKAO_CLIENT_SECRET;

    const tokenResp = await fetch(
        `https://kauth.kakao.com/oauth/token?grant_type=authorization_code&client_id=${encodeURIComponent(
            clientId || ""
        )}&client_secret=${encodeURIComponent(
            clientSecret || ""
        )}&redirect_uri=${encodeURIComponent(
            `${url.origin}/api/auth/kakao/callback`
        )}&code=${encodeURIComponent(code)}`,
        { method: "POST" }
    );

    if (!tokenResp.ok) {
        const txt = await tokenResp.text();
        console.error("KAKAO token exchange failed", txt);
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
        const admin = initAdmin;
        const customToken = await admin
            .auth()
            .createCustomToken(uid, { provider: "kakao", email, name });

        const html = `<!doctype html>
<html>
  <body>
    <script>
      try {
        const data = { type: 'oauth', provider: 'kakao', customToken: ${JSON.stringify(
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
        res.cookies.set({ name: "oauth_state", value: "", maxAge: 0 });
        res.cookies.set({ name: "oauth_return_to", value: "", maxAge: 0 });
        return res;
    } catch (err) {
        console.error("Failed to create custom token", err);
        return new NextResponse("Server error", { status: 500 });
    }
}
