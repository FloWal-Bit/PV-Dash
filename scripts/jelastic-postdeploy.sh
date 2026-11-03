#!/bin/bash
# Post-Deploy-Hook für Infomaniak Jelastic Cloud (Prebuilt).
# Im Deploy-Dialog unter "Hooks" → Post:
#   bash ~/ROOT/scripts/jelastic-postdeploy.sh
#
# Erwartet ein fertiges Artifact (kein npm run build auf dem Node):
#   1) GitHub Release Asset zur package.json-Version, oder
#   2) lokale Datei ~/ROOT/pv-dash-prebuilt.tgz, oder
#   3) bereits entpacktes server.js (Archive-Upload).
#
# Notfall (teuer, Dynamic-Cloudlets): ALLOW_LEGACY_BUILD=1
set -euo pipefail
cd ~/ROOT

log() { echo "[postdeploy] $*" >&2; }

log "mode=prebuilt cwd=$PWD"

preserve_data() {
  mkdir -p .data
}

# Alte On-Node-Builds füllen die Quota (node_modules ~500MB, .next ~400MB, npm-Cache GB).
purge_build_debris() {
  log "purging legacy build debris (node_modules/.next/npm-cache)"
  rm -rf \
    node_modules \
    .next \
    dist \
    .turbo \
    .swc \
    coverage \
    2>/dev/null || true
  rm -rf \
    "$HOME/.npm/_cacache" \
    "$HOME/.npm/_logs" \
    "$HOME/.cache/yarn" \
    "$HOME/.cache/node-gyp" \
    2>/dev/null || true
  rm -f /tmp/pv-dash-prebuilt-*.tgz 2>/dev/null || true
  df -h "$HOME" 2>/dev/null | tail -1 || true
}

read_app_version() {
  # Hooks haben manchmal kein brauchbares `node` im PATH — Version ohne Node lesen.
  if [ -f package.json ]; then
    local ver
    ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
    if [ -n "$ver" ]; then
      printf '%s\n' "$ver"
      return 0
    fi
  fi
  if command -v node >/dev/null 2>&1 && [ -f package.json ]; then
    node -p "require('./package.json').version" 2>/dev/null || true
  fi
}

install_from_tarball() {
  local tarball="$1"
  log "extracting $(basename "$tarball")"
  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$tarball" -C "$tmp"
  if [ ! -f "$tmp/server.js" ]; then
    log "ERROR: server.js fehlt im Artifact."
    rm -rf "$tmp"
    exit 1
  fi
  # Runtime-Daten und Secrets behalten; Hook-Skripte nicht löschen.
  rsync -a --delete \
    --exclude '.data/' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'pv-dash-prebuilt.tgz' \
    --exclude 'scripts/' \
    "$tmp"/ "$PWD"/
  rm -rf "$tmp"
  rm -f pv-dash-prebuilt.tgz /tmp/pv-dash-prebuilt-*.tgz 2>/dev/null || true
}

download_github_release() {
  local version="$1"
  local tag="v${version}"
  local url="https://github.com/FloWal-Bit/PV-Dash/releases/download/${tag}/pv-dash-prebuilt.tgz"
  local out="/tmp/pv-dash-prebuilt-${version}.tgz"
  log "downloading $url"
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if curl -fsSL --retry 2 --connect-timeout 20 -L -o "$out" "$url"; then
      if [ -s "$out" ]; then
        printf '%s\n' "$out"
        return 0
      fi
    fi
    log "Asset noch nicht da (Versuch $attempt/6) — warte 30s"
    sleep 30
  done
  return 1
}

legacy_build() {
  log "ALLOW_LEGACY_BUILD=1 — teurer Fallback (npm install + build)"
  local available_mb
  available_mb=$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  log "MemAvailable≈${available_mb} MB"
  local MIN_AVAILABLE_MB=500
  if [ "$available_mb" -lt "$MIN_AVAILABLE_MB" ]; then
    log "ERROR: Nur ${available_mb} MB frei (braucht ≥${MIN_AVAILABLE_MB} MB)."
    exit 137
  fi
  local heap_mb=$((available_mb * 55 / 100))
  if [ "$heap_mb" -lt 512 ]; then heap_mb=512; fi
  if [ "$heap_mb" -gt 1536 ]; then heap_mb=1536; fi
  local max_heap=$((available_mb - 150))
  if [ "$max_heap" -lt 384 ]; then max_heap=384; fi
  if [ "$heap_mb" -gt "$max_heap" ]; then heap_mb=$max_heap; fi
  export NODE_OPTIONS="--max-old-space-size=${heap_mb}"
  export NEXT_TELEMETRY_DISABLED=1
  export npm_config_audit=false
  export npm_config_fund=false
  npm install --include=dev --no-audit --no-fund --maxsockets=1
  export NODE_ENV=production
  npm run build
  if [ -f .next/standalone/server.js ]; then
    mkdir -p .next/standalone/.next
    cp -a .next/static .next/standalone/.next/static
    if [ -d public ]; then cp -a public .next/standalone/public; fi
  fi
}

preserve_data

# Schon ein Prebuilt-Root?
if [ -f server.js ] && [ -d .next/static ] && [ -f .prebuilt-version ]; then
  log "existing prebuilt server.js — light cleanup only"
  rm -rf "$HOME/.npm/_cacache" "$HOME/.npm/_logs" dist 2>/dev/null || true
  rm -f /tmp/pv-dash-prebuilt-*.tgz pv-dash-prebuilt.tgz 2>/dev/null || true
  log "version=$(cat .prebuilt-version)"
  exit 0
fi

purge_build_debris

VERSION="$(read_app_version || true)"
log "package.json version=${VERSION:-<leer>}"

TARBALL=""
if [ -f pv-dash-prebuilt.tgz ]; then
  TARBALL="$PWD/pv-dash-prebuilt.tgz"
  log "using local pv-dash-prebuilt.tgz"
elif [ -n "$VERSION" ]; then
  if TARBALL="$(download_github_release "$VERSION")"; then
    log "download ok: $TARBALL"
  else
    TARBALL=""
    log "download failed for v${VERSION}"
  fi
else
  log "keine Version lesbar — Download übersprungen"
fi

if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
  install_from_tarball "$TARBALL"
  log "prebuilt installed"
  if [ -f .prebuilt-version ]; then
    log "version=$(cat .prebuilt-version)"
  fi
  exit 0
fi

if [ "${ALLOW_LEGACY_BUILD:-0}" = "1" ]; then
  legacy_build
  exit 0
fi

cat >&2 <<EOF
[postdeploy] ERROR: Kein Prebuilt gefunden.

Erwartet:
  • GitHub Release: https://github.com/FloWal-Bit/PV-Dash/releases/download/v${VERSION:-X.Y.Z}/pv-dash-prebuilt.tgz
  • oder Datei ~/ROOT/pv-dash-prebuilt.tgz

Sofort per Web-SSH (Workaround):
  cd ~/ROOT
  curl -fsSL -L -o /tmp/pv-dash-prebuilt.tgz \\
    https://github.com/FloWal-Bit/PV-Dash/releases/download/v1.5.7.3/pv-dash-prebuilt.tgz
  mkdir -p /tmp/pb && tar -xzf /tmp/pv-dash-prebuilt.tgz -C /tmp/pb
  rsync -a --delete --exclude '.data/' --exclude '.env' --exclude '.env.*' --exclude 'scripts/' /tmp/pb/ ~/ROOT/
  rm -rf /tmp/pb /tmp/pv-dash-prebuilt.tgz
  # Danach App neu starten (Dashboard → Restart)

Notfall (teuer): ALLOW_LEGACY_BUILD=1 bash ~/ROOT/scripts/jelastic-postdeploy.sh
EOF
exit 1
