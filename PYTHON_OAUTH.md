# Python OAuth Integration Example

This example shows how to integrate Nova AI authentication into your Python application without running a local HTTP server.

## Flow Overview

1. **Request Login Session**: Python app calls API to create a session
2. **Open Browser**: Opens user's browser to the login URL
3. **User Logs In**: User authenticates in browser
4. **Poll for Result**: Python app polls API to get user info
5. **Session Complete**: Receive user credentials

## Python Example Code

```python
import requests
import webbrowser
import time

class NovaAIAuth:
    def __init__(self, base_url="https://nova-ai.work"):
        self.base_url = base_url
    
    def login(self):
        """
        Authenticate user and return user info.
        Returns dict with: uid, email, name, photoUrl, tier
        """
        # Step 1: Create login session
        print("Creating login session...")
        response = requests.post(f"{self.base_url}/api/auth/create-session")
        
        if response.status_code != 200:
            raise Exception(f"Failed to create session: {response.text}")
        
        data = response.json()
        session_id = data["sessionId"]
        login_url = data["loginUrl"]
        
        print(f"Session created: {session_id}")
        print(f"Opening browser for login...")
        
        # Step 2: Open browser for user to login
        webbrowser.open(login_url)
        
        # Step 3: Poll for completion
        print("Waiting for login to complete...")
        max_attempts = 120  # 10 minutes (5 second intervals)
        
        for attempt in range(max_attempts):
            time.sleep(5)  # Poll every 5 seconds
            
            response = requests.get(
                f"{self.base_url}/api/auth/get-session",
                params={"session": session_id}
            )
            
            if response.status_code == 404 or response.status_code == 410:
                raise Exception("Session expired or not found")
            
            if response.status_code != 200:
                continue
            
            data = response.json()
            
            if data["status"] == "completed":
                print("Login successful!")
                return data["user"]
            elif data["status"] == "pending":
                print(f"Still waiting... ({attempt + 1}/{max_attempts})")
                continue
        
        raise Exception("Login timeout - user did not complete login")

# Usage
if __name__ == "__main__":
    auth = NovaAIAuth()
    
    try:
        user = auth.login()
        print(f"Logged in as: {user['name']} ({user['email']})")
        print(f"User ID: {user['uid']}")
        print(f"Tier: {user['tier']}")
        
        # Now you can use user['uid'] for API calls
        
    except Exception as e:
        print(f"Login failed: {e}")
```

## API Endpoints

### Create Session
```
POST /api/auth/create-session
Response: { sessionId, loginUrl }
```

### Check Session Status
```
GET /api/auth/get-session?session={sessionId}
Response: 
  - { status: "pending", message: "..." }
  - { status: "completed", user: { uid, email, name, photoUrl, tier } }
```

## Features

- ✅ No local server required
- ✅ Works on any platform (Windows, Mac, Linux)
- ✅ Automatic session expiry (10 minutes)
- ✅ One-time use tokens (deleted after retrieval)
- ✅ Browser-based authentication
- ✅ Support for all OAuth providers (Google, Naver, Kakao)

## Security Notes

- Sessions expire after 10 minutes
- Sessions are single-use (deleted after retrieval)
- HTTPS only in production
- No credentials stored in Python app
