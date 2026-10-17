#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Download: https://nodejs.org/" >&2
  exit 1
fi

URL="http://127.0.0.1:8787"

(
  sleep 1
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  fi
) &

echo "Weight Butler: $URL"
exec node app/server.js
