#!/bin/bash
# Notfall-Rollback auf ein älteres Prebuilt-Release (Infomaniak Jelastic).
# Per Web-SSH / CMD:
#   bash ~/ROOT/scripts/jelastic-rollback.sh 1.5.7.29
# oder ohne Git-Sync (Skriptinhalt paste'n) mit TAG=… direkt unten.
#
# Lädt pv-dash-prebuilt.tgz vom GitHub-Release, extrahiert nach ~/ROOT,
# behält .data / .env / scripts/, cached ~/pv-dash-prebuilt.tgz.
set -euo pipefail

VERSION="${1:-${PREBUILT_VERSION:-}}"
VERSION="${VERSION#v}"
if [ -z "$VERSION" ]; then
  echo "Usage: bash jelastic-rollback.sh <version>" >&2
  echo "Beispiel: bash ~/ROOT/scripts/jelastic-rollback.sh 1.5.7.29" >&2
  echo "Optional: PREBUILT_VERSION=1.5.7.29 bash ~/ROOT/scripts/jelastic-rollback.sh" >&2
  exit 1
fi

ROOT="${HOME}/ROOT"
if [ ! -d "$ROOT" ]; then
  echo "[rollback] ERROR: $ROOT fehlt" >&2
  exit 1
fi
cd "$ROOT"

log() { echo "[rollback] $*" >&2; }

TAG="v${VERSION}"
OUT="/tmp/pv-dash-prebuilt-${VERSION}.tgz"
TOKEN="${GITHUB_RELEASE_TOKEN:-${GH_TOKEN:-}}"
REPO="FloWal-Bit/PV-Dash"
ASSET="pv-dash-prebuilt.tgz"

download_public() {
  local url="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
  log "download (public) $url"
  curl -fsSL --retry 3 --connect-timeout 20 -L -o "$OUT" "$url" && [ -s "$OUT" ]
}

download_private() {
  local api="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"
  local meta
  meta="$(mktemp)"
  log "download (private API) $api"
  if ! curl -fsSL --retry 2 --connect-timeout 20 \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -o "$meta" "$api"; then
    rm -f "$meta"
    return 1
  fi
  local asset_id=""
  if command -v python3 >/dev/null 2>&1; then
    asset_id="$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
a=next((x for x in d.get("assets") or [] if x.get("name")==sys.argv[2]), None)
print(a["id"] if a and a.get("id") is not None else "")
' "$meta" "$ASSET")"
  elif command -v node >/dev/null 2>&1; then
    asset_id="$(node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const a=(d.assets||[]).find(x=>x.name===process.argv[2]);
process.stdout.write(a&&a.id!=null?String(a.id):"");
' "$meta" "$ASSET")"
  fi
  rm -f "$meta"
  if [ -z "$asset_id" ]; then
    log "Release ${TAG} ohne Asset ${ASSET}"
    return 1
  fi
  curl -fsSL --retry 2 --connect-timeout 20 -L \
    -H "Accept: application/octet-stream" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -o "$OUT" \
    "https://api.github.com/repos/${REPO}/releases/assets/${asset_id}" \
    && [ -s "$OUT" ]
}

rm -f "$OUT"
if [ -n "$TOKEN" ] && download_private; then
  log "private download ok"
elif download_public; then
  log "public download ok"
else
  log "ERROR: Download von ${TAG}/${ASSET} fehlgeschlagen"
  log "Prüfe: Release existiert? Repo public oder GITHUB_RELEASE_TOKEN gesetzt?"
  exit 1
fi

tmp="$(mktemp -d)"
log "extract $(basename "$OUT") → $tmp"
tar -xzf "$OUT" -C "$tmp"
if [ ! -f "$tmp/server.js" ]; then
  log "ERROR: server.js fehlt im Artifact"
  rm -rf "$tmp" "$OUT"
  exit 1
fi
if [ ! -f "$tmp/.next/server/middleware-manifest.json" ]; then
  log "WARN: middleware-manifest.json fehlt — App kann mit Internal Server Error starten"
fi

# Alte Marker weg, damit Post-Hook nicht «schon ok» meint.
rm -f .prebuilt-version

# Persistenz: .data ausserhalb ROOT behalten.
PERSIST="${HOME}/pv-dash-persist/.data"
mkdir -p "$PERSIST"
if [ -d .data ] && [ ! -L .data ]; then
  rsync -a .data/ "$PERSIST/" || true
  rm -rf .data
elif [ -L .data ]; then
  rm -f .data
fi

log "rsync → $ROOT (behält .env / scripts / .data)"
rsync -a --delete \
  --exclude '.data/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'pv-dash-prebuilt.tgz' \
  --exclude 'scripts/' \
  "$tmp"/ "$ROOT"/

ln -sfn "$PERSIST" .data
cp -f "$OUT" "${HOME}/pv-dash-prebuilt.tgz"
rm -rf "$tmp" "$OUT"
rm -f "$ROOT/pv-dash-prebuilt.tgz"

log "installed version=$(cat .prebuilt-version 2>/dev/null || echo "$VERSION")"
log "nächster Schritt: Node neu starten (Dashboard Restart oder jem service restart)"
log "Hinweis: PROCESS_MANAGER nicht=supervisor; UPDATE_PACKAGES_ON_RESTART=false"
