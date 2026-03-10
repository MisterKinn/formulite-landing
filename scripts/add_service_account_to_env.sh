#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 /path/to/service-account.json"
  exit 1
fi

SA_PATH=$1
ENV_FILE=".env.local"

if [ ! -f "$SA_PATH" ]; then
  echo "Service account file not found: $SA_PATH"
  exit 2
fi

echo "Encoding service account JSON..."
BASE64_JSON=$(node -e "const fs=require('fs'); const p=process.argv[1]; const b=fs.readFileSync(p); console.log(Buffer.from(b).toString('base64'))" "$SA_PATH")

if [ -z "$BASE64_JSON" ]; then
  echo "Failed to encode service account file"
  exit 3
fi

# Backup existing .env.local
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%s)"
  echo "Backed up existing $ENV_FILE"
else
  touch "$ENV_FILE"
  echo "Created new $ENV_FILE"
fi

# Remove any existing keys we will set
perl -i -ne 'print unless /^FIREBASE_ADMIN_CREDENTIALS_B64=/ || /^FIREBASE_ADMIN_CREDENTIALS=/ || /^GOOGLE_APPLICATION_CREDENTIALS=/' "$ENV_FILE"

# Append new env var
printf "\n# Added by scripts/add_service_account_to_env.sh on %s\nFIREBASE_ADMIN_CREDENTIALS_B64=%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BASE64_JSON" >> "$ENV_FILE"

echo "Wrote FIREBASE_ADMIN_CREDENTIALS_B64 to $ENV_FILE"

echo
cat <<'EOF'
Next steps:
1) Restart your dev server: npm run dev
2) Run the admin health check: ./scripts/check_admin_health.sh
3) Test the password reset endpoint (replace email):
   ./scripts/verify_password_reset.sh existing@example.com

If anything fails, paste the output here and I'll help debug.
EOF
