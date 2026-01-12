import { NextResponse } from "next/server";

interface ExchangeRequest {
    code?: string;
    state?: string;
    returnTo?: string;
}

export async function POST(req: Request) {
    try {
        // Only allow same-origin POSTs from the client
        const origin = req.headers.get("origin");
        if (
            origin &&
            origin !== `${process.env.NEXT_PUBLIC_APP_URL}` &&
            origin !== "http://localhost:3000"
        ) {
            return new NextResponse("Forbidden", { status: 403 });
        }

        const body = (await req.json()) as ExchangeRequest;
        const { code, state, returnTo } = body;
        if (!code) return new NextResponse("Missing code", { status: 400 });

        const clientId =
            process.env.KAKAO_CLIENT_ID || process.env.KAKAO_REST_API_KEY;
        const clientSecret = process.env.KAKAO_CLIENT_SECRET || "";
        const tokenUrl = "https://kauth.kakao.com/oauth/token";
        const redirectUri =
            process.env.KAKAO_REDIRECT_URI ||
            `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/kakao/callback`;

        if (!clientId) {
            return new NextResponse("Server misconfiguration", { status: 500 });
        }

        if (!clientId)
            return new NextResponse("Server misconfiguration", { status: 500 });

        // Exchange code for access token
        // Build token request params; only include client_secret if provided to avoid sending empty param
        const params = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            redirect_uri: redirectUri,
        });
        if (clientSecret) params.set("client_secret", clientSecret);

        const tokenResp = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
            body: params.toString(),
        });

        if (!tokenResp.ok) {
            const txt = await tokenResp.text();
            console.error("[KAKAO exchange] token exchange failed", txt);
            // In dev, return the provider response in the 500 body to help debugging.
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
            console.error("[KAKAO exchange] profile fetch failed", txt);
            return new NextResponse("Failed to fetch profile", { status: 500 });
        }

        const profile = await profileResp.json();
        const kakaoId = profile?.id;
        const kakaoAccount = profile?.kakao_account || {};
        const email = kakaoAccount?.email;
        const name = kakaoAccount?.profile?.nickname || "";

        if (!kakaoId) {
            console.error("[KAKAO exchange] profile missing id", profile);
            return new NextResponse("Invalid profile", { status: 500 });
        }

        const uid = `kakao:${kakaoId}`;

        try {
            const getFirebaseAdmin = (await import("@/lib/firebaseAdmin"))
                .default;
            const admin = getFirebaseAdmin();
            const customToken = await admin
                .auth()
                .createCustomToken(uid, { provider: "kakao", email, name });

            // Persist profile to Firestore
            try {
                const db = admin.firestore();
                await db
                    .collection("users")
                    .doc(uid)
                    .set(
                        {
                            avatar:
                                kakaoAccount?.profile?.profile_image_url ||
                                null,
                            displayName:
                                kakaoAccount?.profile?.nickname || null,
                            email: kakaoAccount?.email || null,
                            createdAt: Date.now(),
                        },
                        { merge: true }
                    );
            } catch (err: any) {
                console.warn(
                    "[KAKAO exchange] Failed to persist profile to Firestore",
                    err?.message || err
                );
            }

            return NextResponse.json({ customToken, profile });
        } catch (err: any) {
            console.error(
                "[KAKAO exchange] Failed to create custom token",
                err
            );
            return new NextResponse(
                "Server misconfiguration: Firebase Admin not configured",
                { status: 500 }
            );
        }
    } catch (err) {
        console.error("[/api/auth/kakao/exchange] error", err);
        return new NextResponse("Server error", { status: 500 });
    }
}
