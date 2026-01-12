#!/usr/bin/env bash
set -euo pipefail

EMAIL=${1:-test@example.com}

echo "1) Running admin health check"
./scripts/check_admin_health.sh || true

echo
echo "2) Calling password-reset endpoint for $EMAIL"
curl -i -X POST http://localhost:3000/api/auth/password-reset \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\"}"

echo
echo "If you see HTTP 200 { ok: true }, server succeeded. If you see 500, check tmp diagnostics and server logs."
