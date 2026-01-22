import { NextResponse } from "next/server";

// /api/auth/naver/start?return_to={origin}
export async function GET(req: Request) {
    const url = new URL(req.url);
    const returnTo = url.searchParams.get("return_to") || "";

    const clientId = process.env.NAVER_CLIENT_ID;
    // Use env var or default to production domain (no www for Naver)
    const redirectUri =
        process.env.NAVER_REDIRECT_URI ||
        (url.origin.includes("localhost")
            ? `${url.origin}/api/auth/naver/callback`
            : "https://nova-ai.work/api/auth/naver/callback");

    console.info(
        "[/api/auth/naver/start] redirect_uri:",
        redirectUri,
        "origin:",
        url.origin,
    );

    if (!clientId) {
        return NextResponse.json(
            { error: "NAVER_CLIENT_ID not configured" },
            { status: 500 },
        );
    }

    // generate state and store in a secure cookie
    // Accept an optional client-generated state parameter. If provided, we will NOT set a server-side cookie
    // and expect the client to perform the code exchange (client verifies state stored in localStorage first).
    const clientProvidedState = url.searchParams.get("state");
    const state = clientProvidedState || Math.random().toString(36).slice(2);

    // Build authorize URL exactly as per Naver docs:
    // https://nid.naver.com/oauth2.0/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={CALLBACK_URL_ENCODED}&state={STATE}
    const authorizeUrl = `https://nid.naver.com/oauth2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;

    console.info("[/api/auth/naver/start] authorizeUrl:", authorizeUrl);

    const res = NextResponse.redirect(authorizeUrl);

    if (!clientProvidedState) {
        // set cookies for state and returnTo (include path & reasonable maxAge)
        // Use a short expiry and explicit path. Keep SameSite=lax to allow top-level redirects; if you need stricter cross-site behavior
        // consider SameSite=None + Secure in production on HTTPS.
        res.cookies.set({
            name: "oauth_state",
            value: state,
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: 10 * 60, // 10 minutes
        });
        if (returnTo) {
            res.cookies.set({
                name: "oauth_return_to",
                value: returnTo,
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                maxAge: 10 * 60,
            });
        }
        try {
            console.info("[/api/auth/naver/start] set state cookie", {
                state,
                returnTo,
            });
        } catch (e) {}
    } else {
        // We're using client-provided state; helpful debug log
        try {
            console.info(
                "[/api/auth/naver/start] using client-provided state",
                { state, returnTo },
            );
        } catch (e) {}
    }
    return res;
}
