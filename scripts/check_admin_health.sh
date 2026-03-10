#!/usr/bin/env bash
set -euo pipefail

URL="http://localhost:3000/api/admin/health"

echo "Checking Firebase Admin health at ${URL}..."
if command -v curl >/dev/null 2>&1; then
  curl -sS -X GET "$URL" | jq || curl -sS -X GET "$URL"
else
  node -e "(async () => { const res = await (await import('node:fetch')).default('$URL'); const body = await res.text(); console.log(body); })().catch(e => { console.error(e); process.exit(1); })"
fi
