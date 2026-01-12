import { NextResponse } from "next/server";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const returnTo = url.searchParams.get("return_to") || "";

    const clientId =
        process.env.KAKAO_CLIENT_ID || process.env.KAKAO_REST_API_KEY;
    const redirectUri = `${url.origin}/api/auth/kakao/callback`;

    if (!clientId) {
        return NextResponse.json(
            { error: "KAKAO_CLIENT_ID not configured" },
            { status: 500 }
        );
    }

    if (!process.env.KAKAO_CLIENT_ID && process.env.KAKAO_REST_API_KEY) {
        console.warn(
            "[KAKAO start] using KAKAO_REST_API_KEY as client_id fallback for local testing"
        );
    }

    // Prefer client-provided state when supplied to support client-side exchange fallback flows
    const state = url.searchParams.get("state") || Math.random().toString(36).slice(2);
    if (url.searchParams.get("state")) {
        console.info("[KAKAO start] using provided state from client");
    }

    const authorizeUrl = new URL("https://kauth.kakao.com/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);

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
