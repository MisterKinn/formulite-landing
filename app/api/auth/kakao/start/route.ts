import { NextResponse } from "next/server";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const returnToParam = url.searchParams.get("return_to") || "";
    // Decode client-sent return_to (client often uses encodeURIComponent)
    let returnTo = "";
    try {
        returnTo = returnToParam ? decodeURIComponent(returnToParam) : "";
    } catch (err) {
        returnTo = returnToParam;
    }

    const clientId =
        process.env.KAKAO_CLIENT_ID || process.env.KAKAO_REST_API_KEY;
    const redirectUri =
        process.env.KAKAO_REDIRECT_URI ||
        `https://www.nova-ai.work/api/auth/kakao/callback`;

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
    const state =
        url.searchParams.get("state") || Math.random().toString(36).slice(2);
    if (url.searchParams.get("state")) {
        console.info("[KAKAO start] using provided state from client");
    }

    // Log redirect_uri in production to diagnose KOE006 mismatches
    try {
        console.info("[KAKAO start] redirect_uri", {
            redirectUri,
            origin: url.origin,
            host: url.host,
            returnTo,
        });
    } catch (e) {
        // ignore logging errors
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

    // Optional debug mode for development: set a cookie so the callback page will render
    // a non-closing diagnostic UI that shows the postMessage payload and target.
    const debug = url.searchParams.get("debug");
    if (debug === "1") {
        console.info("[KAKAO start] debug mode enabled");
        res.cookies.set({ name: "oauth_debug", value: "1", sameSite: "lax" });
    }

    return res;
}
