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

echo "[postdeploy] mode=prebuilt cwd=$PWD"

preserve_data() {
  mkdir -p .data
}

# Alte On-Node-Builds füllen die Quota (node_modules ~500MB, .next ~400MB, npm-Cache GB).
# Prebuilt braucht das nicht — vor/nach dem Extract wegräumen.
purge_build_debris() {
  echo "[postdeploy] purging legacy build debris (node_modules/.next/npm-cache)"
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

install_from_tarball() {
  local tarball="$1"
  echo "[postdeploy] extracting $(basename "$tarball")"
  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$tarball" -C "$tmp"
  if [ ! -f "$tmp/server.js" ]; then
    echo "[postdeploy] ERROR: server.js fehlt im Artifact." >&2
    rm -rf "$tmp"
    exit 1
  fi
  # Zuerst Platz schaffen, sonst scheitert rsync an voller Quota.
  purge_build_debris
  # Runtime-Daten und Secrets behalten; Rest durch Prebuilt ersetzen.
  rsync -a --delete \
    --exclude '.data/' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'pv-dash-prebuilt.tgz' \
    --exclude 'scripts/' \
    "$tmp"/ "$PWD"/
  # start.sh aus dem Artifact reicht; Hook-Skript bleibt über Git-Sync für den nächsten Publish.
  # Falls scripts/ vom Git-Tree noch da sein soll: nicht löschen wenn tarball keine scripts hat —
  # --exclude scripts/ verhindert, dass rsync --delete die Hook-Skripte entfernt, solange
  # sie nur im Git-Tree lagen. Nach Overlay ohne scripts/ im Target bleiben bestehende.
  # Besser: scripts aus Source behalten.
  rm -rf "$tmp"
  # Tarball nicht auf der Quota behalten
  rm -f pv-dash-prebuilt.tgz /tmp/pv-dash-prebuilt-*.tgz 2>/dev/null || true
}

download_github_release() {
  local version="$1"
  local tag="v${version}"
  local url="https://github.com/FloWal-Bit/PV-Dash/releases/download/${tag}/pv-dash-prebuilt.tgz"
  local out="/tmp/pv-dash-prebuilt-${version}.tgz"
  echo "[postdeploy] downloading $url"
  local attempt
  for attempt in 1 2 3 4 5 6 7 8; do
    if curl -fsSL --retry 2 --connect-timeout 20 -o "$out" "$url"; then
      echo "$out"
      return 0
    fi
    echo "[postdeploy] Asset noch nicht da (Versuch $attempt/8) — warte 45s (CI-Build?)"
    sleep 45
  done
  return 1
}

legacy_build() {
  echo "[postdeploy] ALLOW_LEGACY_BUILD=1 — teurer Fallback (npm install + build)"
  local available_mb
  available_mb=$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  echo "[postdeploy] MemAvailable≈${available_mb} MB"
  local MIN_AVAILABLE_MB=500
  if [ "$available_mb" -lt "$MIN_AVAILABLE_MB" ]; then
    echo "[postdeploy] ERROR: Nur ${available_mb} MB frei (braucht ≥${MIN_AVAILABLE_MB} MB)." >&2
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

# Schon ein Prebuilt-Root (z. B. Archive-Upload)?
if [ -f server.js ] && [ -d .next/static ] && [ -f .prebuilt-version ]; then
  echo "[postdeploy] existing prebuilt server.js — light cleanup only"
  # Kein volles node_modules/.next löschen: das IST das Prebuilt.
  rm -rf "$HOME/.npm/_cacache" "$HOME/.npm/_logs" dist 2>/dev/null || true
  rm -f /tmp/pv-dash-prebuilt-*.tgz pv-dash-prebuilt.tgz 2>/dev/null || true
  echo "[postdeploy] version=$(cat .prebuilt-version)"
  exit 0
fi

# Vor Download Platz schaffen (sonst „keine Speicherkapazität“).
purge_build_debris

VERSION=""
if [ -f package.json ]; then
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
fi

TARBALL=""
if [ -f pv-dash-prebuilt.tgz ]; then
  TARBALL="$PWD/pv-dash-prebuilt.tgz"
elif [ -n "$VERSION" ]; then
  if TARBALL="$(download_github_release "$VERSION")"; then
    :
  else
    TARBALL=""
  fi
fi

if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
  install_from_tarball "$TARBALL"
  echo "[postdeploy] prebuilt installed"
  if [ -f .prebuilt-version ]; then
    echo "[postdeploy] version=$(cat .prebuilt-version)"
  fi
  exit 0
fi

if [ "${ALLOW_LEGACY_BUILD:-0}" = "1" ]; then
  legacy_build
  exit 0
fi

cat >&2 <<EOF
[postdeploy] ERROR: Kein Prebuilt gefunden.

Erwartet eine der Varianten:
  • GitHub Release Asset: v\${version}/pv-dash-prebuilt.tgz
    (Workflow „Prebuilt release“ nach Merge abwarten, dann Veröffentlichen)
  • Datei ~/ROOT/pv-dash-prebuilt.tgz
  • Archive-Upload des Pack-Inhalts (server.js + .next/static)

Lokal packen:  npm run pack:prebuilt
Notfall (teuer): ALLOW_LEGACY_BUILD=1 bash ~/ROOT/scripts/jelastic-postdeploy.sh
EOF
exit 1
