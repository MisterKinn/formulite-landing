#!/usr/bin/env bash
# Usage: ./scripts/add_firebase_admin_to_env.sh /path/to/serviceAccountKey.json
# This script will add FIREBASE_ADMIN_CREDENTIALS_B64 to .env.local (creates backup .env.local.bak)
# SECURITY: Do NOT commit your .env.local to source control. Verify before running.

set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/serviceAccountKey.json"
  exit 2
fi
KEY_FILE="$1"
ENV_FILE=".env.local"
if [ ! -f "$KEY_FILE" ]; then
  echo "File not found: $KEY_FILE"
  exit 2
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "No .env.local found, creating new one"
  touch "$ENV_FILE"
fi
# Make a backup copy
cp "$ENV_FILE" "$ENV_FILE.bak"

# Base64 encode without newlines
B64=$(base64 "$KEY_FILE" | tr -d '\n')
# Remove any previous FIREBASE_ADMIN_CREDENTIALS_B64 lines
grep -v "^FIREBASE_ADMIN_CREDENTIALS_B64=" "$ENV_FILE.bak" > "$ENV_FILE"
# Append the new line
printf "\nFIREBASE_ADMIN_CREDENTIALS_B64=%s\n" "$B64" >> "$ENV_FILE"

echo "Added FIREBASE_ADMIN_CREDENTIALS_B64 to $ENV_FILE (backup at $ENV_FILE.bak)."
echo "Restart your dev server (npm run dev) and verify with:\n  curl \"http://localhost:3000/api/debug/firebase-admin?admin_secret=\$ADMIN_SECRET\""

exit 0
