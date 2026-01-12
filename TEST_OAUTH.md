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
