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
        const allowedOrigins = [
            process.env.NEXT_PUBLIC_APP_URL,
            "https://www.nova-ai.work",
            "https://nova-ai.work",
            "http://localhost:3000",
        ].filter(Boolean);

        if (origin && !allowedOrigins.includes(origin)) {
            console.error(
                "[NAVER exchange] origin rejected:",
                origin,
                "allowed:",
                allowedOrigins,
            );
            return new NextResponse("Forbidden", { status: 403 });
        }

        const body = (await req.json()) as ExchangeRequest;
        const { code, state, returnTo } = body;
        if (!code) return new NextResponse("Missing code", { status: 400 });

        const clientId = process.env.NAVER_CLIENT_ID;
        const clientSecret = process.env.NAVER_CLIENT_SECRET;
        // Must match exactly what was registered in Naver Developers (no www for Naver)
        const redirectUri =
            process.env.NAVER_REDIRECT_URI ||
            "https://nova-ai.work/api/auth/naver/callback";

        if (!clientId || !clientSecret) {
            return new NextResponse("Server misconfiguration", { status: 500 });
        }

        // Exchange code for access token - using GET method as per Naver Node.js example
        const tokenUrl = `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${encodeURIComponent(
            clientId,
        )}&client_secret=${encodeURIComponent(
            clientSecret,
        )}&redirect_uri=${encodeURIComponent(
            redirectUri,
        )}&code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || "")}`;

        console.info(
            "[NAVER exchange] tokenUrl:",
            tokenUrl.replace(clientSecret, "***"),
        );

        const tokenResp = await fetch(tokenUrl, {
            method: "GET",
            headers: {
                "X-Naver-Client-Id": clientId,
                "X-Naver-Client-Secret": clientSecret,
            },
        });

        if (!tokenResp.ok) {
            const txt = await tokenResp.text();
            console.error("[NAVER exchange] token exchange failed", txt);
            return new NextResponse("Token exchange failed", { status: 500 });
        }

        const tokenJson = await tokenResp.json();
        const accessToken = tokenJson.access_token;
        if (!accessToken)
            return new NextResponse("Missing access token", { status: 500 });

        // Fetch user profile
        const profileResp = await fetch("https://openapi.naver.com/v1/nid/me", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!profileResp.ok) {
            const txt = await profileResp.text();
            console.error("[NAVER exchange] profile fetch failed", txt);
            return new NextResponse("Failed to fetch profile", { status: 500 });
        }

        const profile = await profileResp.json();
        const naverId = profile?.response?.id;
        const email = profile?.response?.email;
        const name =
            profile?.response?.name || profile?.response?.nickname || "";

        if (!naverId) {
            console.error("[NAVER exchange] profile missing id", profile);
            return new NextResponse("Invalid profile", { status: 500 });
        }

        // Create Firebase custom token
        try {
            const getFirebaseAdmin = (await import("@/lib/firebaseAdmin"))
                .default;
            const admin = getFirebaseAdmin();
            const uid = `naver:${naverId}`;
            const customToken = await admin
                .auth()
                .createCustomToken(uid, { provider: "naver", email, name });
            // Persist profile to Firestore so the app can read email/name immediately after exchange
            try {
                const db = admin.firestore();
                const docRef = db.collection("users").doc(uid);
                await docRef.set(
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
                    "[NAVER exchange] Failed to persist profile to Firestore",
                    err?.message || err,
                );
            }

            return NextResponse.json({
                customToken,
                profile: profile?.response || { id: naverId, email, name },
            });
        } catch (err: any) {
            console.error(
                "[NAVER exchange] Failed to create custom token",
                err,
            );
            return new NextResponse(
                "Server misconfiguration: Firebase Admin not configured",
                { status: 500 },
            );
        }
    } catch (err) {
        console.error("[/api/auth/naver/exchange] error", err);
        return new NextResponse("Server error", { status: 500 });
    }
}
