This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Animations & Korean locale

-   The page content is localized to Korean and uses gentle CSS animations plus AOS for scroll-triggered reveals.
-   AOS is initialized in `app/page.tsx` (`AOS.init`) and `data-aos` attributes are applied to all major components and cards.
-   To tweak motion, adjust the `AOS.init` options (duration, easing, offset, once) or per-element `data-aos-delay` values.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

-   [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
-   [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

## Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Troubleshooting Google Login 🔧

If Google sign-in fails, check the following:

-   Ensure Firebase environment variables are set in your environment (e.g. `.env.local`):
    -   `NEXT_PUBLIC_FIREBASE_API_KEY`
    -   `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
    -   `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
-   In the Firebase Console (Authentication → Sign-in method), make sure **Google** is enabled.
-   Confirm the **Authorized domains** in Firebase include your development domain (e.g., `localhost`) and your deployed domain.
-   If using Google OAuth client configuration in Cloud Console, ensure **Authorized JavaScript origins** and **Redirect URIs** include your domains.
-   Some environments block popups or third-party cookies; the app falls back to the redirect flow when popups are not supported.
-   Reproduce the error in a browser and check the console for a detailed error message (code and message are now logged by the app).

If you're still stuck, capture the browser console error and network trace and open an issue with the exact error code and steps to reproduce.

---

## Third-party OAuth providers (Naver / Kakao) 🚀

This app supports sign-in via Naver and Kakao using a popup + backend exchange that mints Firebase Custom Tokens.

Required environment variables (server-side):

-   `NAVER_CLIENT_ID`
-   `NAVER_CLIENT_SECRET`
-   `KAKAO_CLIENT_ID`
-   `KAKAO_CLIENT_SECRET`
-   `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_ADMIN_CREDENTIALS` (service account) — required by `firebase-admin` to create custom tokens.

How it works:

1. The frontend opens `/api/auth/{provider}/start?return_to={origin}` in a popup.
2. The server redirects to the provider's OAuth authorize endpoint and stores a state cookie.
3. The provider redirects back to `/api/auth/{provider}/callback`, where the server exchanges the code for an access token, fetches the user's profile, and mints a Firebase custom token using the service account.
4. The callback returns a tiny page that posts the custom token to `window.opener` and closes the popup.
5. The frontend receives the custom token and calls `signInWithCustomToken` to sign the user into Firebase.

Security notes:

-   Ensure `NAVER_CLIENT_SECRET` and `KAKAO_CLIENT_SECRET` are kept secret (server-only env vars).
-   The server validates `state` stored in cookies to mitigate CSRF.

If you'd like, I can add logging, tests, or a server-side user provisioning step (e.g., store the provider profile in Firestore).
