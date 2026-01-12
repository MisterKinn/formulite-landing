import { NextResponse } from "next/server";

// /api/auth/naver/start?return_to={origin}
export async function GET(req: Request) {
    const url = new URL(req.url);
    const returnTo = url.searchParams.get("return_to") || "";

    const clientId = process.env.NAVER_CLIENT_ID;
    const redirectUri = `${url.origin}/api/auth/naver/callback`;

    if (!clientId) {
        return NextResponse.json(
            { error: "NAVER_CLIENT_ID not configured" },
            { status: 500 }
        );
    }

    // generate state and store in a secure cookie
    const state = Math.random().toString(36).slice(2);

    const authorizeUrl = new URL("https://nid.naver.com/oauth2.0/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);

    // set cookies for state and returnTo
    const res = NextResponse.redirect(authorizeUrl.toString());
    res.cookies.set({
        name: "oauth_state",
        value: state,
        httpOnly: true,
        sameSite: "lax",
    });
    if (returnTo) {
        res.cookies.set({
            name: "oauth_return_to",
            value: returnTo,
            httpOnly: true,
            sameSite: "lax",
        });
    }

    return res;
}
