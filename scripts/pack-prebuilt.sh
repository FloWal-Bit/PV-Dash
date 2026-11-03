#!/bin/bash
# Baut ein lauffähiges Infomaniak-/Jelastic-Paket ohne Build auf dem Node.
# Ausgabe: dist/pv-dash-prebuilt.tgz
set -euo pipefail
cd "$(dirname "$0")/.."

export NEXT_TELEMETRY_DISABLED=1
export NODE_ENV=production

echo "[pack] npm ci"
npm ci --no-audit --no-fund

echo "[pack] next build (standalone)"
npm run build

if [ ! -f .next/standalone/server.js ]; then
  echo "[pack] ERROR: .next/standalone/server.js fehlt — output: 'standalone' in next.config?" >&2
  exit 1
fi

rm -rf dist/jelastic
mkdir -p dist/jelastic

# Standalone-Tree ist das Deploy-Root (eigener package.json + getrace'te modules).
cp -a .next/standalone/. dist/jelastic/

mkdir -p dist/jelastic/.next
cp -a .next/static dist/jelastic/.next/static
if [ -d public ]; then
  cp -a public dist/jelastic/public
fi

VERSION="$(node -p "require('./package.json').version")"

# Jelastic setzt PORT; Hostname muss 0.0.0.0 sein (Proxy vor dem Node).
cat > dist/jelastic/start.sh <<'EOF'
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export NODE_ENV=production
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-3000}"
exec node server.js
EOF
chmod +x dist/jelastic/start.sh

cat > dist/jelastic/package.json <<EOF
{
  "name": "pv-dash",
  "version": "$VERSION",
  "private": true,
  "scripts": {
    "start": "bash start.sh"
  }
}
EOF

# Marker für den Post-Deploy-Hook
printf '%s\n' "$VERSION" > dist/jelastic/.prebuilt-version

mkdir -p dist
TAR="dist/pv-dash-prebuilt.tgz"
rm -f "$TAR"
tar -czf "$TAR" -C dist/jelastic .
SIZE="$(wc -c < "$TAR" | tr -d ' ')"
echo "[pack] OK → $TAR (${SIZE} bytes), version $VERSION"
echo "[pack] Release-Asset-Name: pv-dash-prebuilt.tgz (Tag v$VERSION)"
