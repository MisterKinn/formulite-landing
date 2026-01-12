# Test OAuth (Naver & Kakao)

This file explains how to test the new Naver/Kakao popup -> backend -> Firebase Custom Token flow locally.

1. Add environment variables (in `.env.local`):

    - `NAVER_CLIENT_ID`
    - `NAVER_CLIENT_SECRET`
    - `KAKAO_CLIENT_ID`
    - `KAKAO_CLIENT_SECRET`
    - `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_ADMIN_CREDENTIALS` (service account JSON)

2. In provider consoles, set the redirect URI to:

    - `http://localhost:3000/api/auth/naver/callback` (Naver)
    - `http://localhost:3000/api/auth/kakao/callback` (Kakao)

# Developer convenience: quick setup of Firebase Admin creds

If you have the service account JSON locally, you can run:

```bash
./scripts/add_firebase_admin_to_env.sh /abs/path/to/serviceAccountKey.json
```

This will back up your `.env.local` to `.env.local.bak` and add `FIREBASE_ADMIN_CREDENTIALS_B64=...`.

Then restart the dev server and verify:

```bash
curl "http://localhost:3000/api/debug/firebase-admin?admin_secret=$ADMIN_SECRET"
```

If you want to quickly test the client popup flow without contacting Naver, there's a dev-only simulated endpoint (requires `ADMIN_SECRET`):

```bash
# simulate a Naver callback that mints a Firebase custom token and posts to window.opener
# opens a page you can use as the popup
open "http://localhost:3000/api/debug/simulate-naver?admin_secret=$ADMIN_SECRET&id=test123&email=you@example.com&name=Test+User"
```

This is strictly for local development and disabled in production.

3. Start the app:

```bash
npm run dev
```

4. Open the login page: `http://localhost:3000/login` and click the appropriate provider button.

5. Approve the provider consent; the popup will post a Firebase custom token to the parent window and close. The app signs in automatically.

Notes:

-   If popups are blocked, allow popups or test in an incognito window.
-   For production, make sure `NAVER_CLIENT_SECRET` and `KAKAO_CLIENT_SECRET` are only available on the server.
-   Consider adding Firestore provisioning of provider profiles if you want to store more metadata for users.

Server-side exchange support and persistence:

-   The server now writes provider profiles (email, displayName, avatar) to Firestore during the OAuth flow for both **Naver** and **Kakao**. This guarantees the `users/{uid}` doc contains `email` and `displayName` immediately after sign-in, so the Profile page can display them even when the Auth user object lacks those fields.
-   For Kakao we also provide a client-exchange endpoint `/api/auth/kakao/exchange` so webviews or clients that lose cookies can POST `{ code, state }` and get `{ customToken, profile }` back (profile is also persisted server-side).

**Important:** Minting Firebase custom tokens requires Firebase Admin credentials (service account). For local development, set either:

-   `FIREBASE_ADMIN_CREDENTIALS` — JSON string of your service account key (recommended for env vars)
-   `FIREBASE_ADMIN_CREDENTIALS_B64` — base64-encoded JSON string (useful for platforms that strip newlines)
-   `GOOGLE_APPLICATION_CREDENTIALS` — absolute path to the service account JSON file

Do NOT commit your service account JSON to source control; use your platform's secret management for production.

You can verify your environment by calling the protected debug endpoint (replace ADMIN_SECRET):

```bash
curl "http://localhost:3000/api/debug/firebase-admin?admin_secret=$ADMIN_SECRET"
```

It will return `{ ok: true }` when initialization succeeds.

Example commands to set admin credentials locally (macOS / Linux):

# 1) If you have the JSON file, either set the path for application-defaults:

export GOOGLE_APPLICATION_CREDENTIALS="/abs/path/to/serviceAccountKey.json"

# then restart `npm run dev`.

# 2) Or encode it to env var (preferred when using .env.local):

./scripts/encode_firebase_admin.sh /abs/path/to/serviceAccountKey.json

# Copy the printed `FIREBASE_ADMIN_CREDENTIALS_B64=...` line into your `.env.local` (do NOT commit it).

# Restart the dev server afterwards.

# 3) Quick temp export for current shell (does not persist):

export FIREBASE_ADMIN_CREDENTIALS_B64=$(base64 /abs/path/to/serviceAccountKey.json | tr -d '\n')

# Then verify via the debug endpoint:

curl "http://localhost:3000/api/debug/firebase-admin?admin_secret=$ADMIN_SECRET"

# Security note: never commit service account JSON or its base64 value to source control. Use your hosting provider's secret manager in production.
