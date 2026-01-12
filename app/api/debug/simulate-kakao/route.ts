import { NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const provided =
        url.searchParams.get("admin_secret") ||
        req.headers.get("x-admin-secret");
    const adminSecret = process.env.ADMIN_SECRET;
    const providedEffective =
        provided === "$ADMIN_SECRET" || provided === "ENV"
            ? adminSecret
            : provided;

    if (!adminSecret || providedEffective !== adminSecret) {
        return new NextResponse(
            "Unauthorized: missing or incorrect admin_secret. Use ?admin_secret=<YOUR_ADMIN_SECRET> or set header x-admin-secret",
            { status: 401 }
        );
    }

    if (process.env.NODE_ENV === "production") {
        return new NextResponse("Not allowed in production", { status: 403 });
    }

    const id = url.searchParams.get("id") || "test-kakao-id";
    const email = url.searchParams.get("email") || "test@example.com";
    const name = url.searchParams.get("name") || "Test Kakao";

    try {
        const devBypass = process.env.DEV_AUTH_BYPASS === "true";

        // Build a simple Kakao-like profile object
        const profileObj = {
            id,
            kakao_account: {
                email,
                profile: {
                    nickname: name,
                    profile_image_url:
                        url.searchParams.get("profile_image") || null,
                },
            },
            // A convenience top-level alias some client code expects
            profile_image: url.searchParams.get("profile_image") || null,
        } as any;

        if (devBypass) {
            const devHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dev-simulated Kakao sign-in complete</title>
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
    <h1>Dev-simulated Kakao sign-in complete</h1>
    <p class="message">Dev-simulated Kakao sign-in complete (dev bypass). You can close this window.</p>
    <p class="note">This window will attempt to close automatically. If it doesn’t, you can close it manually.</p>
    <button class="btn" onclick="window.close()">Close window</button>
  </div>
  <script>
      try {
        const data = { type: 'oauth-dev', provider: 'kakao', profile: ${JSON.stringify(
            profileObj
        )} };
        const target = window.opener?.location?.origin || '*';
        window.opener && window.opener.postMessage(data, target);
      } catch(e) { console.error(e); }
      window.close();
    </script>
</body>
</html>`;
            return new NextResponse(devHtml, {
                headers: { "Content-Type": "text/html" },
            });
        }

        const admin = getFirebaseAdmin();
        const uid = `kakao:${id}`;
        const customToken = await admin
            .auth()
            .createCustomToken(uid, { provider: "kakao", email, name });

        // Persist simulated profile to Firestore
        try {
            const db = admin.firestore();
            await db
                .collection("users")
                .doc(uid)
                .set(
                    {
                        avatar: profileObj.profile.profile_image_url || null,
                        displayName:
                            profileObj.kakao_account.profile.nickname || null,
                        email: profileObj.kakao_account.email || null,
                        createdAt: Date.now(),
                    },
                    { merge: true }
                );
        } catch (err: any) {
            console.warn(
                "[/api/debug/simulate-kakao] Failed to persist simulated profile to Firestore",
                err?.message || err
            );
        }

        const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign-in complete</title>
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
    <h1>Sign-in complete</h1>
    <p class="message">Dev-simulated Kakao sign-in complete. You can close this window.</p>
    <p class="note">This window will attempt to close automatically. If it doesn’t, you can close it manually.</p>
    <button class="btn" onclick="window.close()">Close window</button>
  </div>
  <script>
      try {
        const data = { type: 'oauth', provider: 'kakao', customToken: ${JSON.stringify(
            customToken
        )}, profile: ${JSON.stringify(profileObj)} };
        const target = window.opener?.location?.origin || '*';
        window.opener && window.opener.postMessage(data, target);
      } catch(e) { console.error(e); }
      window.close();
    </script>
</body>
</html>`;

        return new NextResponse(html, {
            headers: { "Content-Type": "text/html" },
        });
    } catch (err: any) {
        console.error("[/api/debug/simulate-kakao] error", err);
        return new NextResponse(String(err?.message || err), { status: 500 });
    }
}
