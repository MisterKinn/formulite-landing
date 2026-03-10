#!/usr/bin/env bash
# Usage: ./scripts/encode_firebase_admin.sh /path/to/serviceAccountKey.json
# This script prints a recommended FIREBASE_ADMIN_CREDENTIALS_B64 line you can add to your .env.local

set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/serviceAccountKey.json"
  exit 2
fi
KEY_FILE="$1"
if [ ! -f "$KEY_FILE" ]; then
  echo "File not found: $KEY_FILE"
  exit 2
fi
# Base64-encode without newlines
B64=$(base64 "$KEY_FILE" | tr -d '\n')
printf "Add the following line to your .env.local (do NOT commit the file):\n\n"
printf "FIREBASE_ADMIN_CREDENTIALS_B64=%s\n\n" "$B64"
printf "Alternatively (temporary for this shell), run:\n\n"
printf "export FIREBASE_ADMIN_CREDENTIALS_B64=%s\n\n" "$B64"
printf "Verify with the debug endpoint (replace ADMIN_SECRET):\n\n"
printf "curl \"http://localhost:3000/api/debug/firebase-admin?admin_secret=\$ADMIN_SECRET\"\n"

exit 0
