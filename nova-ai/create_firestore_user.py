from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict

import requests

from backend.firebase_profile import FIREBASE_CONFIG, _get_admin_access_token
from backend.oauth_desktop import get_stored_user


def _fs_value(value: Any) -> Dict[str, Any]:
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    return {"stringValue": str(value)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or upsert Firestore users/{uid} document")
    parser.add_argument("--uid", help="Firebase uid (default: from local user_account.json)")
    parser.add_argument("--tier", default="free", help="Plan tier value (default: free)")
    parser.add_argument("--usage", type=int, default=0, help="aiCallUsage initial value (default: 0)")
    args = parser.parse_args()

    project_id = FIREBASE_CONFIG.get("projectId")
    if not project_id:
        print("FIREBASE projectId is not configured.", file=sys.stderr)
        return 1

    token = _get_admin_access_token()
    if not token:
        print("Failed to get admin access token from service account.", file=sys.stderr)
        return 1

    user = get_stored_user() or {}
    uid = (args.uid or user.get("uid") or "").strip()
    if not uid:
        print("UID is required. Use --uid or login first.", file=sys.stderr)
        return 1

    fields = {
        "uid": _fs_value(uid),
        "tier": _fs_value(args.tier),
        "displayName": _fs_value(user.get("name") or ""),
        "email": _fs_value(user.get("email") or ""),
        "photoURL": _fs_value(user.get("photo_url") or ""),
        "aiCallUsage": _fs_value(max(0, int(args.usage))),
    }

    url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}"
        f"/databases/(default)/documents/users/{uid}"
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {"fields": fields}

    try:
        response = requests.patch(url, headers=headers, json=payload, timeout=20)
    except Exception as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        return 1

    if response.status_code not in (200, 201):
        print(f"Upsert failed: HTTP {response.status_code}", file=sys.stderr)
        print(response.text, file=sys.stderr)
        return 1

    data = response.json()
    print("Firestore user document upserted.")
    print(json.dumps({"uid": uid, "tier": args.tier, "usage": args.usage}, ensure_ascii=False))
    print(data.get("name", ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
