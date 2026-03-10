"""
OAuth Desktop Flow for Nova AI
Handles browser-based OAuth login via configured web app login URL.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from typing import Optional, Dict, Any

# Login page URL
# Override with NOVA_WEB_BASE_URL when needed (e.g. staging/preview).
WEB_BASE_URL = os.getenv(
    "NOVA_WEB_BASE_URL",
    "https://www.nova-ai.work",
).rstrip("/")
LOGIN_URL = f"{WEB_BASE_URL}/login"
CALLBACK_PORT = 8765
CALLBACK_PATH = "/auth-callback"

_PLAN_ALIASES = {
    "free": "free",
    "standard": "plus",
    "plus": "plus",
    "pro": "pro",
    "test": "test",
}


def _normalize_plan_tier(value: Any, fallback: str = "free") -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return fallback
    return _PLAN_ALIASES.get(raw, fallback)


def _get_user_data_dir() -> Path:
    """Get the user data directory for storing credentials."""
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            user_dir = Path(appdata) / "Nova AI"
        else:
            user_dir = Path(__file__).resolve().parent
    else:
        user_dir = Path.home() / ".nova-ai"
    
    try:
        user_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        user_dir = Path(__file__).resolve().parent
    
    return user_dir


def _get_user_file_path() -> Path:
    """Get the path to user_account.json."""
    return _get_user_data_dir() / "user_account.json"


def get_stored_user() -> Optional[Dict[str, Any]]:
    """
    Returns the cached user from user_account.json, or None if not logged in.
    
    Returns dict with keys:
      - uid: string (Firebase user ID) - REQUIRED
      - name: string (display name)
      - email: string
      - tier: string ("Free", "Standard", "Pro")
      - photo_url: string (avatar URL)
      - idToken: string (Firebase ID token for API calls)
      - refreshToken: string (for token refresh)
    """
    user_file = _get_user_file_path()
    
    if not user_file.exists():
        return None
    
    try:
        data = json.loads(user_file.read_text(encoding="utf-8"))
        if data.get("uid"):
            normalized_plan = _normalize_plan_tier(
                data.get("plan") or data.get("tier"),
                "free",
            )
            data["plan"] = normalized_plan
            data["tier"] = normalized_plan
            return data
        return None
    except Exception:
        return None


def save_user(user_data: Dict[str, Any]) -> bool:
    """Save user data to user_account.json."""
    user_file = _get_user_file_path()
    
    try:
        user_file.write_text(
            json.dumps(user_data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        return True
    except Exception as e:
        print(f"Failed to save user data: {e}")
        return False


def logout_user() -> bool:
    """Deletes user_account.json to log out."""
    user_file = _get_user_file_path()
    
    try:
        if user_file.exists():
            user_file.unlink()
        return True
    except Exception as e:
        print(f"Failed to logout: {e}")
        return False


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """HTTP request handler for OAuth callback."""
    
    user_data: Optional[Dict[str, Any]] = None
    
    def log_message(self, format, *args):
        """Suppress HTTP server logs."""
        pass
    
    def do_GET(self):
        """Handle GET request from OAuth callback."""
        parsed = urlparse(self.path)
        
        if parsed.path == CALLBACK_PATH:
            # Parse query parameters
            params = parse_qs(parsed.query)
            incoming_plan = params.get("plan", [""])[0]
            incoming_tier = params.get("tier", [""])[0]
            normalized_plan = _normalize_plan_tier(incoming_plan or incoming_tier, "free")
            
            # Extract user data from callback
            user_data = {
                "uid": params.get("uid", [""])[0],
                "name": params.get("name", [""])[0],
                "email": params.get("email", [""])[0],
                "tier": normalized_plan,
                "plan": normalized_plan,
                "photo_url": params.get("photo_url", [""])[0],
                "handle": params.get("handle", [""])[0],
                "idToken": params.get("idToken", [""])[0],
                "refreshToken": params.get("refreshToken", [""])[0],
            }
            
            if user_data["uid"]:
                # Save user data
                save_user(user_data)
                OAuthCallbackHandler.user_data = user_data
                
                # Send success response
                self.send_response(200)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()
                
                success_html = """
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>로그인 성공</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            background: #0a0a0f;
                            color: white;
                            overflow: hidden;
                        }

                        /* Ambient background glows */
                        .bg-glow-1 {
                            position: fixed;
                            top: 50%; left: 50%;
                            transform: translate(-50%, -50%);
                            width: 500px; height: 500px;
                            border-radius: 50%;
                            background: radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(139,92,246,0.12) 40%, transparent 70%);
                            filter: blur(80px);
                            pointer-events: none;
                        }
                        .bg-glow-2 {
                            position: fixed;
                            top: 25%; right: 25%;
                            width: 250px; height: 250px;
                            border-radius: 50%;
                            background: radial-gradient(circle, rgba(6,182,212,0.1) 0%, transparent 70%);
                            filter: blur(60px);
                            pointer-events: none;
                        }

                        /* Grid overlay */
                        .bg-grid {
                            position: fixed;
                            inset: 0;
                            opacity: 0.03;
                            background-image:
                                linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                                linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px);
                            background-size: 60px 60px;
                            pointer-events: none;
                        }

                        .container {
                            position: relative;
                            z-index: 1;
                            text-align: center;
                            max-width: 400px;
                            width: 100%;
                            padding: 0 24px;
                        }

                        /* Success icon */
                        .icon-wrapper {
                            position: relative;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            margin-bottom: 32px;
                        }
                        .icon-ring {
                            position: absolute;
                            width: 112px; height: 112px;
                            border-radius: 50%;
                            border: 1px solid rgba(16,185,129,0.25);
                            animation: ringPulse 2.5s ease-out infinite;
                        }
                        .icon-circle {
                            width: 88px; height: 88px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            background: linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(99,102,241,0.15) 100%);
                            border: 1px solid rgba(16,185,129,0.25);
                            box-shadow: 0 0 40px rgba(16,185,129,0.12), inset 0 1px 0 rgba(255,255,255,0.04);
                            animation: scaleIn 0.4s ease-out forwards;
                        }
                        .icon-circle svg {
                            width: 38px; height: 38px;
                            filter: drop-shadow(0 0 8px rgba(16,185,129,0.5));
                        }
                        .check-path {
                            stroke-dasharray: 24;
                            stroke-dashoffset: 24;
                            animation: checkDraw 0.6s ease-out 0.3s forwards;
                        }

                        /* Text */
                        h1 {
                            font-size: 2rem;
                            font-weight: 600;
                            letter-spacing: -0.02em;
                            margin-bottom: 10px;
                            background: linear-gradient(90deg, #e2e8f0 0%, #f8fafc 50%, #e2e8f0 100%);
                            background-size: 200% auto;
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            animation: fadeUp 0.5s ease-out 0.6s both, shimmer 3s linear 1.1s infinite;
                        }
                        .subtitle {
                            font-size: 1rem;
                            color: #9ca3af;
                            font-weight: 300;
                            animation: fadeUp 0.5s ease-out 0.8s both;
                        }

                        /* Countdown badge */
                        .countdown-badge {
                            display: inline-flex;
                            align-items: center;
                            gap: 8px;
                            margin-top: 28px;
                            padding: 8px 18px;
                            border-radius: 999px;
                            background: rgba(255,255,255,0.04);
                            border: 1px solid rgba(255,255,255,0.08);
                            animation: fadeUp 0.5s ease-out 1.0s both;
                        }
                        .countdown-dot {
                            width: 6px; height: 6px;
                            border-radius: 50%;
                            background: #10b981;
                            animation: pulse 1.5s ease-in-out infinite;
                        }
                        .countdown-text {
                            font-size: 0.75rem;
                            color: #9ca3af;
                            font-family: 'SF Mono', 'Fira Code', monospace;
                        }

                        /* Animations */
                        @keyframes checkDraw {
                            0% { stroke-dashoffset: 24; opacity: 0; }
                            40% { opacity: 1; }
                            100% { stroke-dashoffset: 0; opacity: 1; }
                        }
                        @keyframes scaleIn {
                            0% { transform: scale(0.7); opacity: 0; }
                            100% { transform: scale(1); opacity: 1; }
                        }
                        @keyframes fadeUp {
                            0% { transform: translateY(14px); opacity: 0; }
                            100% { transform: translateY(0); opacity: 1; }
                        }
                        @keyframes ringPulse {
                            0% { transform: scale(1); opacity: 0.4; }
                            100% { transform: scale(1.7); opacity: 0; }
                        }
                        @keyframes shimmer {
                            0% { background-position: -200% center; }
                            100% { background-position: 200% center; }
                        }
                        @keyframes pulse {
                            0%, 100% { opacity: 1; }
                            50% { opacity: 0.4; }
                        }
                        @keyframes countdownTick {
                            0% { transform: scale(1); }
                            50% { transform: scale(1.2); }
                            100% { transform: scale(1); }
                        }
                        .tick { animation: countdownTick 0.3s ease-out; }
                    </style>
                </head>
                <body>
                    <div class="bg-glow-1"></div>
                    <div class="bg-glow-2"></div>
                    <div class="bg-grid"></div>

                    <div class="container">
                        <div class="icon-wrapper">
                            <div class="icon-ring"></div>
                            <div class="icon-circle">
                                <svg fill="none" viewBox="0 0 24 24">
                                    <path class="check-path" stroke="#10b981" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                                </svg>
                            </div>
                        </div>
                        <h1>로그인 성공!</h1>
                        <p class="subtitle">로그인 완료 후 Nova AI 메인페이지로 이동합니다.</p>
                        <div class="countdown-badge">
                            <div class="countdown-dot"></div>
                            <span class="countdown-text"><span id="sec">3</span>초 후 자동으로 닫힙니다</span>
                        </div>
                    </div>

                    <script>
                        let t = 3;
                        const el = document.getElementById('sec');
                        const iv = setInterval(() => {
                            t--;
                            if (el) { el.textContent = t; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
                            if (t <= 0) {
                                clearInterval(iv);
                                window.location.href = 'https://www.nova-ai.work/';
                            }
                        }, 1000);
                    </script>
                </body>
                </html>
                """
                self.wfile.write(success_html.encode("utf-8"))
            else:
                # Send error response
                self.send_response(400)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"<h1>Login failed - no user ID</h1>")
        else:
            self.send_response(404)
            self.end_headers()


def start_oauth_flow(timeout: int = 300) -> Optional[Dict[str, Any]]:
    """
    Start the OAuth login flow.
    
    1. Deletes any existing user_account.json
    2. Starts local HTTP server on port 8765
    3. Opens browser to login URL
    4. Waits up to `timeout` seconds for callback
    5. Returns user data if successful, None otherwise
    """
    # Clear previous session
    logout_user()
    OAuthCallbackHandler.user_data = None
    
    # Start local HTTP server
    server = HTTPServer(("127.0.0.1", CALLBACK_PORT), OAuthCallbackHandler)
    server.timeout = timeout
    
    # Build login URL with redirect.
    # force_account_switch=1 asks the web login page to sign out any
    # existing browser session first so users can choose a different account.
    redirect_uri = f"http://localhost:{CALLBACK_PORT}{CALLBACK_PATH}"
    login_params = urlencode(
        {
            "redirect_uri": redirect_uri,
            "force_account_switch": "1",
            "source": "desktop",
        }
    )
    login_url = f"{LOGIN_URL}?{login_params}"
    
    # Open browser
    try:
        webbrowser.open(login_url)
    except Exception as e:
        print(f"Failed to open browser: {e}")
        return None
    
    # Wait for callback
    server_thread = threading.Thread(target=lambda: server.handle_request())
    server_thread.start()
    server_thread.join(timeout=timeout)
    
    try:
        server.server_close()
    except Exception:
        pass
    
    # After login, sync tier from Firebase
    user_data = OAuthCallbackHandler.user_data
    if user_data and user_data.get("uid"):
        try:
            from backend.firebase_profile import refresh_user_profile_from_firebase
            profile = refresh_user_profile_from_firebase()
            if profile:
                normalized_plan = _normalize_plan_tier(
                    profile.get("plan") or profile.get("tier"),
                    user_data.get("plan") or user_data.get("tier") or "free",
                )
                user_data["plan"] = normalized_plan
                user_data["tier"] = normalized_plan
                save_user(user_data)
        except Exception:
            pass
    
    return user_data


def is_logged_in() -> bool:
    """Check if a user is currently logged in."""
    user = get_stored_user()
    return user is not None and bool(user.get("uid"))
