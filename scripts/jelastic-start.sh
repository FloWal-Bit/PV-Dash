#!/bin/bash
# Startbefehl für Infomaniak Jelastic (Prebuilt oder klassisch).
# Dashboard → Node.js → Application → Start command:
#   bash scripts/jelastic-start.sh
# oder: npm start
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_ENV=production
# Nicht "${HOSTNAME:-…}": Jelastic/Linux setzt HOSTNAME bereits auf den
# Container-Namen — Next würde nur dort binden → 502 am Proxy.
export HOSTNAME=0.0.0.0
# Jelastic setzt PORT; Fallback nur für lokale Smoke-Tests.
export PORT="${PORT:-3000}"

# Prefers artifact start.sh (stellt node_modules nach npm-prune wieder her).
if [ -f start.sh ] && [ -f server.js ]; then
  echo "[start] delegating to ./start.sh"
  exec bash start.sh
fi

if [ -f server.js ] && [ -d .next/static ]; then
  echo "[start] prebuilt root server.js PORT=$PORT"
  exec node server.js
fi

if [ -f .next/standalone/server.js ]; then
  echo "[start] .next/standalone/server.js PORT=$PORT"
  cd .next/standalone
  if [ ! -d .next/static ] && [ -d ../static ]; then
    mkdir -p .next
    cp -a ../static .next/static
  fi
  if [ ! -d public ] && [ -d ../../public ]; then
    cp -a ../../public public
  fi
  exec node server.js
fi

if [ -d .next ] && command -v npx >/dev/null 2>&1; then
  echo "[start] fallback next start PORT=$PORT"
  exec npx next start --hostname 0.0.0.0 --port "$PORT"
fi

echo "[start] ERROR: kein Prebuilt (server.js) und kein .next — zuerst pack:prebuilt / Post-Deploy." >&2
exit 1
