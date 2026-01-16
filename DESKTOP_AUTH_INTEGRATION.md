# Desktop App Authentication Integration Guide

## Overview

Nova AI now supports server-side OAuth authentication for desktop applications without requiring a local HTTP server. This implementation uses Next.js API routes with Firebase Firestore for session storage.

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│ Desktop App │────1───▶│  nova-ai.work    │         │   Firestore  │
│  (Python)   │         │  /api/auth/*     │────────▶│   Sessions   │
└─────────────┘         └──────────────────┘         └──────────────┘
      │                          │
      │                          │
      │         ┌────────────────┘
      │         │
      │    2.Open Browser
      │         │
      │         ▼
      │   ┌──────────────┐
      │   │   User logs  │
      └──▶│   in via     │
     3.   │   browser    │
    Poll  └──────────────┘
```

## API Routes Implemented

### 1. POST /api/auth/create-session

**File**: `app/api/auth/create-session/route.ts`

Creates a new authentication session for desktop applications.

```typescript
// Request
POST https://nova-ai.work/api/auth/create-session
// No body required

// Response
{
  "sessionId": "session_1737123456_abc123xyz",
  "loginUrl": "https://nova-ai.work/login?session=session_1737123456_abc123xyz"
}
```

**Implementation**:
- Generates unique session ID using timestamp + random string
- Stores session in Firestore `oauth_sessions` collection
- Sets expiration time (10 minutes from creation)
- Returns session ID and login URL for desktop app

---

### 2. GET /api/auth/get-session

**File**: `app/api/auth/get-session/route.ts`

Polls the authentication session status. Desktop app calls this repeatedly until login completes.

```typescript
// Request
GET https://nova-ai.work/api/auth/get-session?session={sessionId}

// Response - Pending
{
  "status": "pending",
  "message": "Waiting for user to complete login"
}

// Response - Completed (one-time retrieval)
{
  "status": "completed",
  "user": {
    "uid": "firebase_user_id",
    "email": "user@example.com",
    "name": "User Name",
    "photoUrl": "https://...",
    "tier": "free"
  }
}

// Error Responses
400: { "error": "Session ID required" }
404: { "error": "Session not found" }
410: { "error": "Session expired" }
```

**Implementation**:
- Validates session ID parameter
- Fetches session from Firestore
- Checks expiration (deletes if expired)
- Returns pending status or completed user data
- **Deletes session after successful retrieval** (one-time use security)

---

### 3. POST /api/auth/complete-session

**File**: `app/api/auth/complete-session/route.ts`

Internal endpoint called by the auth-callback page after successful login.

```typescript
// Request
POST https://nova-ai.work/api/auth/complete-session
Content-Type: application/json

{
  "sessionId": "session_...",
  "uid": "firebase_user_id",
  "name": "User Name",
  "email": "user@example.com",
  "photoUrl": "https://...",
  "tier": "free"
}

// Response
{
  "success": true
}
```

**Implementation**:
- Validates session exists and not expired
- Updates session status to "completed"
- Stores user information in session document
- Desktop app will retrieve this on next poll

---

## Integration with Existing Auth Flow

### Login Page (`app/login/page.tsx`)

The login page checks for `session` parameter and preserves it through the auth flow:

```typescript
const handlePostLoginRedirect = async (user: any) => {
    const sessionId = searchParams?.get("session");

    if (sessionId) {
        // Server-side OAuth flow for desktop app
        const tier = await getUserTier(user.uid);
        
        const params = new URLSearchParams({
            uid: user.uid,
            name: user.displayName || user.email?.split("@")[0],
            email: user.email,
            photo_url: user.photoURL || "",
            tier: tier,
            session: sessionId, // Pass session to callback
        });

        window.location.href = `/auth-callback?${params.toString()}`;
        return;
    }
    
    // Normal web flow continues...
};
```

**What it does**:
1. Detects `session` parameter from URL
2. After successful login, redirects to auth-callback with user info + session ID
3. Auth-callback will complete the server-side session

---

### Auth Callback Page (`app/auth-callback/page.tsx`)

The callback page completes the desktop session:

```typescript
useEffect(() => {
    const sessionId = searchParams?.get("session");
    
    if (sessionId) {
        // Store user info server-side for desktop app
        fetch("/api/auth/complete-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId,
                uid,
                name,
                email,
                photoUrl,
                tier,
            }),
        }).then(() => {
            // Show success and close window
            setTimeout(() => window.close(), 2000);
        });
        return;
    }
    
    // Handle other flows (redirect_uri, normal popup close)...
}, [searchParams]);
```

**What it does**:
1. Detects `session` parameter
2. Calls `/api/auth/complete-session` with user data
3. Shows success message and closes browser window
4. Desktop app polling will now receive the user data

---

## Firestore Schema

**Collection**: `oauth_sessions`

**Document Structure**:
```typescript
{
  // Initial creation
  status: "pending",
  createdAt: Timestamp,
  expiresAt: number, // Unix timestamp
  
  // After completion
  status: "completed",
  uid: string,
  name: string | null,
  email: string | null,
  photoUrl: string | null,
  tier: string,
  completedAt: Timestamp
}
```

**Security Rules** (add to Firestore rules):
```javascript
match /oauth_sessions/{sessionId} {
  // Only allow API routes (server-side) to access
  allow read, write: if false;
}
```

Sessions are server-side only and accessed via Admin SDK (bypasses rules).

---

## Desktop App Integration

### Python Example

```python
import requests
import webbrowser
import time

class NovaAIAuth:
    def __init__(self, base_url="https://nova-ai.work"):
        self.base_url = base_url
    
    def login(self):
        """Authenticate user and return user info."""
        # Step 1: Create session
        response = requests.post(f"{self.base_url}/api/auth/create-session")
        data = response.json()
        
        session_id = data["sessionId"]
        login_url = data["loginUrl"]
        
        print(f"Opening browser for login...")
        webbrowser.open(login_url)
        
        # Step 2: Poll for completion
        print("Waiting for login...")
        max_attempts = 120  # 10 minutes
        
        for attempt in range(max_attempts):
            time.sleep(5)
            
            response = requests.get(
                f"{self.base_url}/api/auth/get-session",
                params={"session": session_id}
            )
            
            if response.status_code == 410:
                raise Exception("Session expired")
            
            if response.status_code == 200:
                data = response.json()
                if data["status"] == "completed":
                    print("Login successful!")
                    return data["user"]
        
        raise Exception("Login timeout")

# Usage
auth = NovaAIAuth()
user = auth.login()
print(f"Logged in: {user['name']} ({user['tier']})")
```

---

## Security Features

1. **Time-based expiration**: Sessions expire after 10 minutes
2. **One-time use**: Sessions deleted immediately after user data retrieval
3. **Server-side storage**: Sessions stored in Firestore (not accessible client-side)
4. **No local server**: Desktop app doesn't expose any network ports
5. **Standard OAuth flow**: Uses existing Google/Naver/Kakao/Email auth

---

## Testing Flow

1. **Start desktop app login**:
   ```bash
   curl -X POST https://nova-ai.work/api/auth/create-session
   ```
   Response: `{"sessionId": "...", "loginUrl": "..."}`

2. **Open login URL in browser**:
   - User sees normal login page
   - URL contains `?session=session_...` parameter

3. **User logs in** (any provider):
   - Google, Naver, Kakao, or Email/Password
   - Redirects to `/auth-callback?session=...&uid=...`

4. **Auth callback completes session**:
   - Calls `/api/auth/complete-session`
   - Updates Firestore session to "completed"
   - Shows success message, closes window

5. **Desktop app receives user data**:
   ```bash
   curl "https://nova-ai.work/api/auth/get-session?session=session_..."
   ```
   Response: `{"status": "completed", "user": {...}}`

---

## Error Handling

| Error Code | Meaning | Desktop App Action |
|------------|---------|-------------------|
| 400 | Missing session param | Retry with correct params |
| 404 | Session not found | Invalid session, restart flow |
| 410 | Session expired | Timeout, restart flow |
| 500 | Server error | Retry after delay |

---

## Production Checklist

- [x] Session storage in Firestore (persists across server restarts)
- [x] Automatic expiration after 10 minutes
- [x] One-time use sessions (deleted after retrieval)
- [x] All OAuth providers supported (Google, Naver, Kakao, Email)
- [x] HTTPS enforced in production
- [ ] Optional: Add rate limiting to create-session endpoint
- [ ] Optional: Add Firestore TTL policy for automatic cleanup
- [ ] Optional: Monitor session metrics (creation rate, completion rate)

---

## Advantages Over localhost Callback

✅ **No local server required** - Desktop app doesn't need to listen on ports
✅ **Firewall friendly** - No incoming connections needed
✅ **Cross-platform** - Works on Windows, Mac, Linux without configuration
✅ **Simple deployment** - No port forwarding or network setup
✅ **Secure** - Sessions stored server-side, single-use tokens
✅ **User friendly** - Opens default browser, standard OAuth experience

---

## Support

For issues or questions about desktop app integration:
- Check session expiration (10 minute limit)
- Verify browser successfully opens login URL
- Check network connectivity for polling requests
- Review Firestore console for session documents
- Enable console logging in desktop app for debugging
