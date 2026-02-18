"""
Firebase Profile Management for Nova AI
Handles Firestore REST API integration for user profiles and AI usage tracking.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from datetime import datetime
from urllib.parse import quote

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request as GoogleAuthRequest
    GOOGLE_AUTH_AVAILABLE = True
except Exception:
    GOOGLE_AUTH_AVAILABLE = False

from backend.oauth_desktop import (
    WEB_BASE_URL,
    get_stored_user,
    save_user,
    _get_user_data_dir,
)


def _load_env_vars() -> None:
    """Load env vars from .env and .env.local files if present."""
    root_dir = Path(__file__).resolve().parent.parent
    env_path = root_dir / ".env"
    env_local_path = root_dir / ".env.local"

    # Load .env first, then .env.local so local values override.
    for path, override in ((env_path, False), (env_local_path, True)):
        if not path.exists():
            continue

        if load_dotenv is not None:
            load_dotenv(dotenv_path=path, override=override)
            continue

        # Fallback parser when python-dotenv is unavailable.
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if not key:
                    continue
                if override or key not in os.environ:
                    os.environ[key] = value
        except Exception:
            pass


def _resolve_firebase_config() -> Dict[str, str]:
    """Resolve Firebase configuration from environment variables."""
    _load_env_vars()

    api_key = (
        os.getenv("FIREBASE_API_KEY")
        or os.getenv("NEXT_PUBLIC_FIREBASE_API_KEY")
        or ""
    )
    project_id = (
        os.getenv("FIREBASE_PROJECT_ID")
        or os.getenv("NEXT_PUBLIC_FIREBASE_PROJECT_ID")
        or ""
    )

    # Optional fallback from service-account JSON blob.
    if not project_id:
        raw_admin_credentials = os.getenv("FIREBASE_ADMIN_CREDENTIALS", "").strip()
        if raw_admin_credentials:
            try:
                credentials = json.loads(raw_admin_credentials)
                project_id = str(credentials.get("project_id") or "").strip()
            except Exception:
                pass

    # Optional fallback from service-account JSON file path.
    if not project_id:
        raw_credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if raw_credentials_path:
            candidate_path = Path(raw_credentials_path)
            if not candidate_path.exists():
                # If env path points elsewhere, try same filename in this project.
                local_candidate = Path(__file__).resolve().parent.parent / candidate_path.name
                if local_candidate.exists():
                    candidate_path = local_candidate
            try:
                if candidate_path.exists():
                    file_credentials = json.loads(candidate_path.read_text(encoding="utf-8"))
                    project_id = str(file_credentials.get("project_id") or "").strip()
            except Exception:
                pass

    return {
        "apiKey": api_key,
        "projectId": project_id,
    }


FIREBASE_CONFIG = _resolve_firebase_config()
_admin_token_cache: Dict[str, Any] = {
    "token": "",
    "expires_at": 0.0,
}

# Normalize web `plan` and legacy desktop `tier` into one canonical value.
_PLAN_ALIASES = {
    "free": "free",
    "standard": "plus",
    "plus": "plus",
    "pro": "pro",
    "ultra": "pro",
    "test": "test",
}


def _normalize_plan_tier(value: Any, fallback: str = "free") -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return fallback
    return _PLAN_ALIASES.get(raw, fallback)


# Plan/Tier Limits (monthly AI calls)
PLAN_LIMITS = {
    "free": 5,
    "Free": 5,
    "standard": 330,
    "Standard": 330,
    "plus": 330,
    "Plus": 330,
    "pro": 2200,
    "Pro": 2200,
    "ultra": 2200,
    "Ultra": 2200,
    "test": 330,
    "Test": 330,
}

ADMIN_UNLIMITED_EMAIL = "admin@gmail.com"
SINGLE_DEVICE_PLANS = {"free", "plus", "test", "standard"}

# Cache for Firebase data (avoid repeated API calls)
_firebase_cache: Dict[str, Any] = {
    "profile": None,
    "usage": None,
    "last_refresh": 0,
}
_CACHE_TTL = 60  # seconds


def _is_admin_unlimited_user(uid: Optional[str] = None) -> bool:
    """
    Return True when current desktop user should bypass AI usage limits.
    """
    user = get_stored_user()
    if not user:
        return False

    stored_uid = str(user.get("uid") or "")
    if uid and stored_uid and str(uid) != stored_uid:
        return False

    email = str(user.get("email") or "").strip().lower()
    return email == ADMIN_UNLIMITED_EMAIL


def _is_single_device_plan(plan_or_tier: Any) -> bool:
    normalized = _normalize_plan_tier(plan_or_tier, "free")
    return normalized in SINGLE_DEVICE_PLANS


class FirebaseProfileError(Exception):
    """Firebase profile operation error."""
    pass


def _resolve_usage_api_base_url() -> str:
    _load_env_vars()
    base = (
        os.getenv("NOVA_USAGE_API_BASE_URL")
        or os.getenv("NOVA_WEB_BASE_URL")
        or os.getenv("NOVA_APP_BASE_URL")
        or os.getenv("NEXT_PUBLIC_APP_URL")
        # Keep usage API base aligned with desktop login target.
        or WEB_BASE_URL
        or "https://www.nova-ai.work"
    )
    return str(base).rstrip("/")


def _sync_cached_user_plan(plan: Any) -> None:
    normalized = _normalize_plan_tier(plan, "free")
    user = get_stored_user()
    if not user:
        return
    if user.get("plan") == normalized and user.get("tier") == normalized:
        return
    user["plan"] = normalized
    user["tier"] = normalized
    save_user(user)


def _fetch_usage_status_from_web(uid: str) -> Optional[Dict[str, Any]]:
    if not REQUESTS_AVAILABLE:
        return None
    if not uid:
        return None

    try:
        base = _resolve_usage_api_base_url()
        url = f"{base}/api/ai/check-limit?userId={quote(uid, safe='')}"
        response = requests.get(
            url,
            timeout=10,
            headers={"Cache-Control": "no-cache"},
        )
        if response.status_code != 200:
            return None
        payload = response.json()
        if not isinstance(payload, dict) or not payload.get("success"):
            return None

        plan = _normalize_plan_tier(payload.get("plan"), "free")
        usage = int(payload.get("currentUsage") or 0)
        limit = int(payload.get("limit") or get_plan_limit(plan))
        remaining = int(payload.get("remaining") or max(0, limit - usage))
        can_use = bool(payload.get("canUse", remaining > 0))

        _sync_cached_user_plan(plan)
        _firebase_cache["usage"] = usage
        _firebase_cache["last_refresh"] = time.time()

        return {
            "plan": plan,
            "currentUsage": usage,
            "limit": limit,
            "remaining": remaining,
            "canUse": can_use,
        }
    except Exception:
        return None


def _increment_usage_via_web(uid: str) -> Optional[Dict[str, Any]]:
    if not REQUESTS_AVAILABLE:
        return None
    if not uid:
        return None

    try:
        base = _resolve_usage_api_base_url()
        url = f"{base}/api/ai/increment-usage"
        response = requests.post(
            url,
            json={"userId": uid},
            timeout=10,
            headers={"Content-Type": "application/json"},
        )
        if response.status_code not in (200, 429):
            return None
        payload = response.json()
        if not isinstance(payload, dict):
            return None

        plan = _normalize_plan_tier(payload.get("plan"), "free")
        usage = int(payload.get("currentUsage") or 0)
        limit = int(payload.get("limit") or get_plan_limit(plan))
        remaining = int(payload.get("remaining") or max(0, limit - usage))
        can_use = response.status_code == 200 and bool(payload.get("success", True))

        _sync_cached_user_plan(plan)
        if response.status_code == 200:
            _firebase_cache["usage"] = usage
            _firebase_cache["last_refresh"] = time.time()

        return {
            "plan": plan,
            "currentUsage": usage,
            "limit": limit,
            "remaining": remaining,
            "canUse": can_use,
        }
    except Exception:
        return None


def _get_service_account_info() -> Optional[Dict[str, Any]]:
    """Load service-account credentials from env JSON/path."""
    raw_admin_credentials = os.getenv("FIREBASE_ADMIN_CREDENTIALS", "").strip()
    if raw_admin_credentials:
        try:
            data = json.loads(raw_admin_credentials)
            if isinstance(data, dict) and data.get("type") == "service_account":
                return data
        except Exception:
            pass

    raw_credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    candidate_path: Optional[Path] = None
    if raw_credentials_path:
        path = Path(raw_credentials_path)
        if path.exists():
            candidate_path = path
        else:
            # If env path points elsewhere, try same filename in this project.
            local_candidate = Path(__file__).resolve().parent.parent / path.name
            if local_candidate.exists():
                candidate_path = local_candidate

    # Last-resort fallback: first matching firebase admin key in project root.
    if candidate_path is None:
        root_dir = Path(__file__).resolve().parent.parent
        candidates = sorted(root_dir.glob("*firebase-adminsdk-*.json"))
        if candidates:
            candidate_path = candidates[-1]

    if candidate_path is None:
        return None

    try:
        data = json.loads(candidate_path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("type") == "service_account":
            return data
    except Exception:
        pass

    return None


def _get_admin_access_token() -> Optional[str]:
    """Get Google OAuth access token using service-account credentials."""
    if not GOOGLE_AUTH_AVAILABLE:
        return None

    now = time.time()
    cached_token = str(_admin_token_cache.get("token") or "")
    cached_expiry = float(_admin_token_cache.get("expires_at") or 0.0)
    if cached_token and now < (cached_expiry - 60):
        return cached_token

    service_account_info = _get_service_account_info()
    if not service_account_info:
        return None

    try:
        credentials = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        credentials.refresh(GoogleAuthRequest())
        token = str(credentials.token or "")
        if not token:
            return None

        expiry = getattr(credentials, "expiry", None)
        expires_at = expiry.timestamp() if expiry else (time.time() + 3300)
        _admin_token_cache["token"] = token
        _admin_token_cache["expires_at"] = expires_at
        return token
    except Exception:
        return None


def _resolve_firestore_auth_token() -> Tuple[Optional[str], str]:
    """Resolve auth token for Firestore API calls."""
    id_token = get_valid_id_token()
    if id_token:
        return id_token, "user"

    id_token = refresh_id_token()
    if id_token:
        return id_token, "user"

    admin_token = _get_admin_access_token()
    if admin_token:
        return admin_token, "admin"

    return None, "none"


def _fetch_firestore_user_doc(
    project_id: str,
    uid: str,
    headers: Dict[str, str],
) -> Tuple[int, Optional[Dict[str, Any]], Optional[str]]:
    """
    Fetch user doc from Firestore.
    1) Try users/{uid}
    2) Fallback to query by field uid == <uid>
    Returns: (status_code, document_json, document_url)
    """
    direct_url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}"
        f"/databases/(default)/documents/users/{uid}"
    )
    response = requests.get(direct_url, headers=headers, timeout=10)
    if response.status_code == 200:
        return 200, response.json(), direct_url
    if response.status_code not in (404,):
        return response.status_code, None, None

    # Fallback query by uid field for projects where documentId != uid.
    query_url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}"
        "/databases/(default)/documents:runQuery"
    )
    query_payload = {
        "structuredQuery": {
            "from": [{"collectionId": "users"}],
            "where": {
                "fieldFilter": {
                    "field": {"fieldPath": "uid"},
                    "op": "EQUAL",
                    "value": {"stringValue": uid},
                }
            },
            "limit": 1,
        }
    }
    query_response = requests.post(query_url, headers=headers, json=query_payload, timeout=10)
    if query_response.status_code != 200:
        return query_response.status_code, None, None

    try:
        items = query_response.json()
        if isinstance(items, list):
            for item in items:
                document = item.get("document")
                if not document:
                    continue
                document_name = document.get("name")
                if not document_name:
                    continue
                doc_url = f"https://firestore.googleapis.com/v1/{document_name}"
                return 200, document, doc_url
    except Exception:
        pass

    return 404, None, None


def _get_local_usage_path() -> Path:
    """Get path to local usage tracking file."""
    return _get_user_data_dir() / "local_usage.json"


def _get_local_usage() -> Dict[str, Any]:
    """Get local usage data (fallback when Firebase unavailable)."""
    path = _get_local_usage_path()
    if not path.exists():
        return {"date": "", "usage": 0}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"date": "", "usage": 0}


def _save_local_usage(data: Dict[str, Any]) -> None:
    """Save local usage data."""
    path = _get_local_usage_path()
    try:
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def get_valid_id_token() -> Optional[str]:
    """
    Get a valid Firebase ID token, refreshing if expired.
    Used for authenticated API calls.
    """
    user = get_stored_user()
    if not user:
        return None
    
    id_token = user.get("idToken")
    refresh_token = user.get("refreshToken")
    
    if not id_token:
        return None
    
    # Try to decode token to check expiry (simple check)
    # In production, you'd properly decode the JWT
    # For now, we'll try to refresh if we have a refresh token
    
    return id_token


def refresh_id_token() -> Optional[str]:
    """Refresh the Firebase ID token using the refresh token."""
    if not REQUESTS_AVAILABLE:
        return None
    if not FIREBASE_CONFIG.get("apiKey"):
        return None
    
    user = get_stored_user()
    if not user or not user.get("refreshToken"):
        return None
    
    try:
        url = f"https://securetoken.googleapis.com/v1/token?key={FIREBASE_CONFIG['apiKey']}"
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": user["refreshToken"]
        }
        
        response = requests.post(url, data=payload, timeout=10)
        data = response.json()
        
        if "id_token" in data:
            # Update stored user with new tokens
            user["idToken"] = data["id_token"]
            if "refresh_token" in data:
                user["refreshToken"] = data["refresh_token"]
            save_user(user)
            return data["id_token"]
        
        return None
    except Exception as e:
        print(f"Token refresh failed: {e}")
        return None


def refresh_user_profile_from_firebase() -> Optional[Dict[str, Any]]:
    """
    Called at app startup to sync latest user data from Firestore.
    
    1. Reads uid from user_account.json
    2. Fetches users/{uid} document from Firestore REST API
    3. Updates local tier/displayName if changed
    4. Returns updated profile dict
    
    Returns dict with keys:
      - uid, tier, display_name, aiCallUsage, email, photo_url
    """
    if not REQUESTS_AVAILABLE:
        return None
    if not FIREBASE_CONFIG.get("projectId"):
        return None
    
    user = get_stored_user()
    if not user or not user.get("uid"):
        return None
    
    uid = user["uid"]
    # Prefer the same canonical usage/plan source used by the web app.
    usage_status = _fetch_usage_status_from_web(uid)
    usage_plan = _normalize_plan_tier(
        (usage_status or {}).get("plan"),
        _normalize_plan_tier(user.get("plan") or user.get("tier"), "free"),
    )
    usage_count = int((usage_status or {}).get("currentUsage") or 0)
    auth_token, auth_mode = _resolve_firestore_auth_token()
    if not auth_token:
        return {
            "uid": uid,
            "tier": usage_plan,
            "plan": usage_plan,
            "display_name": user.get("name", ""),
            "email": user.get("email", ""),
            "photo_url": user.get("photo_url", ""),
            "aiCallUsage": usage_count,
        }
    
    try:
        project_id = FIREBASE_CONFIG["projectId"]
        headers = {"Authorization": f"Bearer {auth_token}"}

        status_code, doc, _ = _fetch_firestore_user_doc(project_id, uid, headers)

        if status_code == 200 and doc:
            fields = doc.get("fields", {})
            
            # Parse Firestore field values
            def get_value(field: Dict) -> Any:
                for key in ["stringValue", "integerValue", "booleanValue", "doubleValue"]:
                    if key in field:
                        val = field[key]
                        if key == "integerValue":
                            return int(val)
                        return val
                return None

            def get_map(field: Dict) -> Dict[str, Any]:
                return field.get("mapValue", {}).get("fields", {}) if isinstance(field, dict) else {}

            subscription_fields = get_map(fields.get("subscription", {}))
            resolved_plan = _normalize_plan_tier(
                get_value(fields.get("plan", {}))
                or get_value(subscription_fields.get("plan", {}))
                or get_value(fields.get("tier", {}))
                or usage_plan
                or user.get("plan")
                or user.get("tier"),
                "free",
            )
            
            profile = {
                "uid": uid,
                "tier": resolved_plan,
                "plan": resolved_plan,
                "display_name": get_value(fields.get("displayName", {})) or user.get("name", ""),
                "email": get_value(fields.get("email", {})) or user.get("email", ""),
                "photo_url": (
                    get_value(fields.get("avatar", {}))
                    or get_value(fields.get("photoURL", {}))
                    or user.get("photo_url", "")
                ),
                "aiCallUsage": (
                    usage_count
                    if usage_status is not None
                    else get_value(fields.get("aiCallUsage", {})) or 0
                ),
            }
            
            # Update local cache if plan/tier changed
            if profile["tier"] != user.get("tier") or profile["plan"] != user.get("plan"):
                user["tier"] = profile["tier"]
                user["plan"] = profile["plan"]
                save_user(user)
            
            return profile
        
        elif status_code == 401 and auth_mode == "user":
            # Token expired, try to refresh
            id_token = refresh_id_token()
            if id_token:
                return refresh_user_profile_from_firebase()  # Retry once
            return {
                "uid": uid,
                "tier": usage_plan,
                "plan": usage_plan,
                "display_name": user.get("name", ""),
                "email": user.get("email", ""),
                "photo_url": user.get("photo_url", ""),
                "aiCallUsage": usage_count,
            }
        
        else:
            print(f"Firebase profile fetch failed: {status_code}")
            return {
                "uid": uid,
                "tier": usage_plan,
                "plan": usage_plan,
                "display_name": user.get("name", ""),
                "email": user.get("email", ""),
                "photo_url": user.get("photo_url", ""),
                "aiCallUsage": usage_count,
            }
            
    except Exception as e:
        print(f"Firebase profile refresh error: {e}")
        return {
            "uid": uid,
            "tier": usage_plan,
            "plan": usage_plan,
            "display_name": user.get("name", ""),
            "email": user.get("email", ""),
            "photo_url": user.get("photo_url", ""),
            "aiCallUsage": usage_count,
        }


def get_user_profile(uid: str) -> Optional[Dict[str, Any]]:
    """
    Get full user profile from Firestore.
    Returns: display_name, email, photo_url, uid, tier, aiCallUsage
    """
    if not uid:
        return None
    
    # Try Firebase first
    profile = refresh_user_profile_from_firebase()
    if profile:
        return profile
    
    # Fallback to cached data
    user = get_stored_user()
    if user and user.get("uid") == uid:
        return {
            "uid": uid,
            "tier": _normalize_plan_tier(user.get("tier") or user.get("plan"), "free"),
            "plan": _normalize_plan_tier(user.get("plan") or user.get("tier"), "free"),
            "display_name": user.get("name", ""),
            "email": user.get("email", ""),
            "photo_url": user.get("photo_url", ""),
            "aiCallUsage": 0,
        }
    
    return None


def get_ai_usage(uid: str) -> int:
    """
    Get current AI call usage count for the user.
    Uses cached data if available and fresh, otherwise fetches from Firebase.
    """
    if not uid:
        return 0
    if _is_admin_unlimited_user(uid):
        # Unlimited users are exempt from usage counting.
        return 0

    # 1) Canonical source: website usage API (same logic as web app)
    web_usage = _fetch_usage_status_from_web(uid)
    if web_usage is not None:
        return int(web_usage.get("currentUsage", 0))

    # 2) Fallback cache / Firestore / local
    now = time.time()

    # Return cached usage if fresh
    if _firebase_cache["usage"] is not None and (now - _firebase_cache["last_refresh"]) < _CACHE_TTL:
        return _firebase_cache["usage"]
    
    # Try to get from Firebase
    profile = refresh_user_profile_from_firebase()
    if profile:
        usage = profile.get("aiCallUsage", 0)
        _firebase_cache["usage"] = usage
        _firebase_cache["last_refresh"] = now
        return usage
    
    # Fallback to local tracking
    local = _get_local_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    
    # Reset if new day
    if local.get("date") != today:
        local = {"date": today, "usage": 0}
        _save_local_usage(local)
    
    return local.get("usage", 0)


def force_refresh_usage() -> int:
    """Force refresh usage from Firebase, bypassing cache."""
    _firebase_cache["usage"] = None
    _firebase_cache["last_refresh"] = 0
    user = get_stored_user()
    if user and user.get("uid"):
        return get_ai_usage(user["uid"])
    return 0


def increment_ai_usage(uid: str) -> bool:
    """
    Atomically increment aiCallUsage field in Firestore.
    Called each time user makes an AI request.
    Returns True if successful.
    """
    if not uid:
        return False
    if _is_admin_unlimited_user(uid):
        # Do not consume quota for admin unlimited account.
        return True

    # 1) Canonical source: website usage API (same logic as web app)
    web_result = _increment_usage_via_web(uid)
    if web_result is not None:
        return bool(web_result.get("canUse"))

    # 2) Fallback Firestore/local
    if not REQUESTS_AVAILABLE:
        # Local fallback
        return _increment_local_usage()
    if not FIREBASE_CONFIG.get("projectId"):
        return _increment_local_usage()
    
    auth_token, auth_mode = _resolve_firestore_auth_token()
    if not auth_token:
        # Fallback to local tracking
        return _increment_local_usage()
    
    try:
        project_id = FIREBASE_CONFIG["projectId"]
        headers = {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }

        # First, get current usage
        status_code, doc, doc_url = _fetch_firestore_user_doc(project_id, uid, headers)

        if status_code == 200 and doc and doc_url:
            fields = doc.get("fields", {})
            current_usage = 0
            
            if "aiCallUsage" in fields:
                val = fields["aiCallUsage"].get("integerValue", 0)
                current_usage = int(val)
            
            # Update with incremented value
            new_usage = current_usage + 1
            update_url = f"{doc_url}?updateMask.fieldPaths=aiCallUsage"
            payload = {
                "fields": {
                    "aiCallUsage": {"integerValue": str(new_usage)}
                }
            }
            
            update_response = requests.patch(update_url, headers=headers, json=payload, timeout=10)
            
            if update_response.status_code in (200, 201):
                # Update cache
                _firebase_cache["usage"] = new_usage
                _firebase_cache["last_refresh"] = time.time()
                return True
            else:
                print(f"Usage update failed: {update_response.status_code}")
                return _increment_local_usage()
        
        elif status_code == 404:
            # Document doesn't exist, create it
            create_url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/users?documentId={uid}"
            payload = {
                "fields": {
                    "uid": {"stringValue": uid},
                    "aiCallUsage": {"integerValue": "1"}
                }
            }
            create_response = requests.post(create_url, headers=headers, json=payload, timeout=10)
            return create_response.status_code in (200, 201)
        
        elif status_code == 401 and auth_mode == "user":
            # User token may be expired/invalid. Retry once with admin token.
            admin_token = _get_admin_access_token()
            if not admin_token:
                return _increment_local_usage()
            headers["Authorization"] = f"Bearer {admin_token}"
            retry_status, retry_doc, retry_doc_url = _fetch_firestore_user_doc(project_id, uid, headers)
            if retry_status == 200 and retry_doc and retry_doc_url:
                doc = retry_doc
                fields = doc.get("fields", {})
                current_usage = 0
                if "aiCallUsage" in fields:
                    val = fields["aiCallUsage"].get("integerValue", 0)
                    current_usage = int(val)
                new_usage = current_usage + 1
                update_url = f"{retry_doc_url}?updateMask.fieldPaths=aiCallUsage"
                payload = {
                    "fields": {
                        "aiCallUsage": {"integerValue": str(new_usage)}
                    }
                }
                update_response = requests.patch(update_url, headers=headers, json=payload, timeout=10)
                if update_response.status_code in (200, 201):
                    _firebase_cache["usage"] = new_usage
                    _firebase_cache["last_refresh"] = time.time()
                    return True
            return _increment_local_usage()
        else:
            return _increment_local_usage()
            
    except Exception as e:
        print(f"Firebase usage increment error: {e}")
        return _increment_local_usage()


def _increment_local_usage() -> bool:
    """Increment usage in local tracking file (fallback)."""
    local = _get_local_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    
    # Reset if new day
    if local.get("date") != today:
        local = {"date": today, "usage": 0}
    
    local["usage"] = local.get("usage", 0) + 1
    _save_local_usage(local)
    return True


def get_remaining_usage(uid: str, tier: str = "free") -> int:
    """
    Get remaining AI calls for today.
    """
    if _is_admin_unlimited_user(uid):
        # Large sentinel value to represent "practically unlimited".
        return 10**9

    web_usage = _fetch_usage_status_from_web(uid)
    if web_usage is not None:
        return max(0, int(web_usage.get("remaining", 0)))

    current_usage = get_ai_usage(uid)
    limit = get_plan_limit(tier)
    return max(0, int(limit) - int(current_usage))


def check_usage_limit(uid: str, tier: str = "Free") -> bool:
    """
    Check if user has remaining AI calls.
    Returns True if user can make more calls.
    """
    if _is_admin_unlimited_user(uid):
        return True

    web_usage = _fetch_usage_status_from_web(uid)
    if web_usage is not None:
        return bool(web_usage.get("canUse", False))
    return get_remaining_usage(uid, _normalize_plan_tier(tier, "free")) > 0


def get_plan_limit(tier: str) -> int:
    """Get the daily limit for a given plan/tier."""
    normalized = _normalize_plan_tier(tier, "free")
    return PLAN_LIMITS.get(normalized, PLAN_LIMITS.get("free", 5))


def register_desktop_device_session(
    uid: str,
    desktop_session_id: str,
    tier: str = "free",
    email: str = "",
) -> bool:
    """
    Register current desktop instance as active session.
    Single-device plans (free/plus/test/standard) enforce one active desktop.
    """
    if not REQUESTS_AVAILABLE:
        return False
    if not uid or not desktop_session_id:
        return False

    email_norm = str(email or "").strip().lower()
    if email_norm == ADMIN_UNLIMITED_EMAIL:
        return True

    normalized_tier = _normalize_plan_tier(tier, "free")
    if not _is_single_device_plan(normalized_tier):
        return True

    try:
        base = _resolve_usage_api_base_url()
        url = f"{base}/api/auth/desktop-activate"
        response = requests.post(
            url,
            json={
                "uid": uid,
                "desktopSessionId": desktop_session_id,
                "tier": normalized_tier,
                "plan": normalized_tier,
                "email": email_norm,
            },
            timeout=10,
            headers={"Content-Type": "application/json"},
        )
        return response.status_code == 200
    except Exception:
        return False


def is_desktop_session_active(
    uid: str,
    desktop_session_id: str,
    tier: str = "free",
    email: str = "",
) -> bool:
    """
    Check whether this desktop instance is still the active one.
    Returns True when session is valid or when validation is unavailable.
    """
    if not REQUESTS_AVAILABLE:
        return True
    if not uid or not desktop_session_id:
        return True

    email_norm = str(email or "").strip().lower()
    if email_norm == ADMIN_UNLIMITED_EMAIL:
        return True

    normalized_tier = _normalize_plan_tier(tier, "free")
    if not _is_single_device_plan(normalized_tier):
        return True

    try:
        base = _resolve_usage_api_base_url()
        url = (
            f"{base}/api/auth/desktop-session-status"
            f"?userId={quote(uid, safe='')}"
            f"&desktopSessionId={quote(desktop_session_id, safe='')}"
        )
        response = requests.get(
            url,
            timeout=8,
            headers={"Cache-Control": "no-cache"},
        )
        if response.status_code != 200:
            return True
        payload = response.json()
        if not isinstance(payload, dict):
            return True
        return bool(payload.get("active", True))
    except Exception:
        return True
