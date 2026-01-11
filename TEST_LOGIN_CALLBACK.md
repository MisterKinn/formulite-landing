# Login Callback Testing Guide

This directory contains test files for the desktop integration login callback feature.

## Test Files

-   **test-server.js** - Simple Node.js HTTP server that runs on localhost:3002
-   **test-callback.html** - Test page that displays received user info from the callback

## How to Test

### 1. Start the Next.js App

```bash
npm run dev
```

Your app should be running on `http://localhost:3000`

### 2. Start the Test Server

In a new terminal:

```bash
node test-server.js
```

The test server will start on `http://localhost:3002`

### 3. Test the Login Flow

**Option A: Use the test server homepage**

1. Open `http://localhost:3002/` in your browser
2. Click "Test Login with Callback" button
3. Log in with your credentials
4. You'll be redirected back to the callback page with user info

**Option B: Direct URL**
Open this URL in your browser:

```
http://localhost:3000/login?redirect_uri=http://localhost:3002/auth-callback
```

### 4. Expected Behavior

After successful login, you should be redirected to:

```
http://localhost:3002/auth-callback?uid=USER_UID&name=USER_NAME&email=USER_EMAIL&photo_url=USER_PHOTO_URL&tier=USER_TIER
```

The test page will display:

-   User ID (UID)
-   Display Name
-   Email
-   Photo URL
-   Subscription Tier

The test server console will also log the received parameters.

## For Desktop App Integration

Your desktop app should:

1. Open the login URL with your callback URI:

    ```
    https://formulite.vercel.app/login?redirect_uri=YOUR_CALLBACK_URI
    ```

2. Listen for the callback on your local server (e.g., `http://localhost:8765/auth-callback`)

3. Parse the query parameters:

    - `uid` - User's Firebase UID
    - `name` - User's display name
    - `email` - User's email
    - `photo_url` - User's profile photo URL
    - `tier` - User's subscription tier (free, plus, premium)

4. Store the user info in your app

## Security Notes

-   All query parameters are URL-encoded
-   The redirect_uri is validated as a proper URL
-   Invalid redirect URIs fall back to `/profile`
-   For production, consider adding allowed redirect URI whitelist
