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
# Privates Repo: Env GITHUB_RELEASE_TOKEN (oder GH_TOKEN) — Fine-grained PAT
# mit Contents: Read auf FloWal-Bit/PV-Dash. Sonst schlägt der Asset-Download fehl.
#
# Notfall (teuer, Dynamic-Cloudlets): ALLOW_LEGACY_BUILD=1
set -euo pipefail
cd ~/ROOT

log() { echo "[postdeploy] $*" >&2; }

log "mode=prebuilt cwd=$PWD"

# Runtime-Daten (Stromkonto, whatwatt-Samples, Dev-Settings, …) liegen bewusst
# ausserhalb von ROOT. Jelastics Git-Publish macht oft `git clean` und löscht
# sonst untracked `.data/` bei jedem Veröffentlichen.
PERSIST_ROOT="${HOME}/pv-dash-persist"
PERSIST_DATA="${PERSIST_ROOT}/.data"

preserve_data() {
  mkdir -p "$PERSIST_DATA"
  if [ -d .data ] && [ ! -L .data ]; then
    log "migrating ROOT/.data → $PERSIST_DATA"
    rsync -a .data/ "$PERSIST_DATA/"
    rm -rf .data
  elif [ -L .data ]; then
    # kaputter Symlink nach git clean → neu setzen
    rm -f .data
  fi
  ln -sfn "$PERSIST_DATA" .data
  log "data → $(readlink -f .data 2>/dev/null || readlink .data) (stromkonto=$([ -f .data/stromkonto.json ] && echo yes || echo no))"
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
  # Tarball unter $HOME behalten: start.sh stellt damit node_modules wieder her,
  # wenn Jelastic vor dem Start `npm install` ausführt und next wegpruned.
  if [ -f "$tarball" ]; then
    cp -f "$tarball" "$HOME/pv-dash-prebuilt.tgz"
    log "cached $HOME/pv-dash-prebuilt.tgz for start-restore"
  fi
  rm -f "$PWD/pv-dash-prebuilt.tgz" /tmp/pv-dash-prebuilt-*.tgz 2>/dev/null || true
  preserve_data
}

# Privates Repo: Release-Assets nur über die GitHub-API mit Token.
# Jelastic-Env: GITHUB_RELEASE_TOKEN (Fine-grained PAT, Contents: Read)
# Fallback-Name: GH_TOKEN. Ohne Token nur öffentlicher Browser-Download.
github_release_token() {
  printf '%s' "${GITHUB_RELEASE_TOKEN:-${GH_TOKEN:-}}"
}

# Asset-ID aus Release-JSON (python3 oder node — Jelastic-Hooks haben oft keins von beidem zuverlässig).
github_asset_id_from_json() {
  local json_file="$1"
  local asset_name="$2"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
name = sys.argv[2]
asset = next((a for a in data.get("assets") or [] if a.get("name") == name), None)
if not asset or asset.get("id") is None:
    sys.exit(2)
print(asset["id"])
' "$json_file" "$asset_name"
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const name = process.argv[2];
const asset = (data.assets || []).find((a) => a.name === name);
if (!asset || asset.id == null) process.exit(2);
process.stdout.write(String(asset.id));
' "$json_file" "$asset_name"
    return $?
  fi
  log "ERROR: weder python3 noch node — Asset-ID für privaten Download nicht lesbar"
  return 1
}

download_github_release_public() {
  local tag="$1"
  local out="$2"
  local url="https://github.com/FloWal-Bit/PV-Dash/releases/download/${tag}/pv-dash-prebuilt.tgz"
  log "downloading (public) $url"
  curl -fsSL --retry 2 --connect-timeout 20 -L -o "$out" "$url" && [ -s "$out" ]
}

# Exit: 0 ok · 22 Auth (401/403) · 1 sonstiger Fehler (Asset fehlt, Netz, …)
download_github_release_private() {
  local tag="$1"
  local out="$2"
  local token="$3"
  local repo="FloWal-Bit/PV-Dash"
  local asset_name="pv-dash-prebuilt.tgz"
  local api="https://api.github.com/repos/${repo}/releases/tags/${tag}"
  local meta http
  meta="$(mktemp)"
  log "downloading (private API) ${api}"
  http="$(
    curl -sS --retry 2 --connect-timeout 20 \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${token}" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -o "$meta" \
      -w "%{http_code}" \
      "$api" || true
  )"
  if [ "$http" = "401" ] || [ "$http" = "403" ]; then
    log "GitHub API ${http} — GITHUB_RELEASE_TOKEN ungültig oder ohne Contents:Read"
    rm -f "$meta"
    return 22
  fi
  if [ "$http" != "200" ]; then
    log "GitHub API HTTP ${http} für ${tag}"
    rm -f "$meta"
    return 1
  fi
  local asset_id
  if ! asset_id="$(github_asset_id_from_json "$meta" "$asset_name")"; then
    log "Release ${tag} ohne Asset ${asset_name} (oder JSON nicht parsebar)"
    rm -f "$meta"
    return 1
  fi
  rm -f "$meta"
  log "asset id=${asset_id}"
  http="$(
    curl -sS --retry 2 --connect-timeout 20 -L \
      -H "Accept: application/octet-stream" \
      -H "Authorization: Bearer ${token}" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -o "$out" \
      -w "%{http_code}" \
      "https://api.github.com/repos/${repo}/releases/assets/${asset_id}" || true
  )"
  if [ "$http" = "401" ] || [ "$http" = "403" ]; then
    log "Asset-Download HTTP ${http} — Token prüfen"
    rm -f "$out"
    return 22
  fi
  if [ "$http" != "200" ] || [ ! -s "$out" ]; then
    log "Asset-Download fehlgeschlagen (HTTP ${http})"
    rm -f "$out"
    return 1
  fi
  return 0
}

download_github_release() {
  local version="$1"
  local tag="v${version}"
  local out="/tmp/pv-dash-prebuilt-${version}.tgz"
  local token
  token="$(github_release_token)"
  local attempt rc

  # Ungültiger Token: einmal private versuchen, dann sofort public — kein 6×30s-Loop.
  if [ -n "$token" ]; then
    rm -f "$out"
    set +e
    download_github_release_private "$tag" "$out" "$token"
    rc=$?
    set -e
    if [ "$rc" -eq 0 ]; then
      printf '%s\n' "$out"
      return 0
    fi
    if [ "$rc" -eq 22 ]; then
      log "Token-Auth fehlgeschlagen — Fallback auf öffentlichen Download"
      rm -f "$out"
      if download_github_release_public "$tag" "$out"; then
        printf '%s\n' "$out"
        return 0
      fi
      log "ERROR: Token ungültig und öffentlicher Download fehlgeschlagen (Repo privat? Token neu setzen)"
      return 1
    fi
  fi

  for attempt in 1 2 3 4 5 6; do
    rm -f "$out"
    if [ -n "$token" ]; then
      set +e
      download_github_release_private "$tag" "$out" "$token"
      rc=$?
      set -e
      if [ "$rc" -eq 0 ]; then
        printf '%s\n' "$out"
        return 0
      fi
      if [ "$rc" -eq 22 ]; then
        log "ERROR: Token mitten im Retry ungültig geworden — Abbruch"
        return 1
      fi
    else
      if download_github_release_public "$tag" "$out"; then
        printf '%s\n' "$out"
        return 0
      fi
      log "Hinweis: ohne GITHUB_RELEASE_TOKEN schlägt der Download bei privatem Repo fehl"
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

prebuilt_runtime_ok() {
  # server.js + static allein reichen nicht — ohne .next/server crasht Next mit
  # «Cannot find module …/middleware-manifest.json».
  [ -f server.js ] \
    && [ -f .prebuilt-version ] \
    && [ -d .next/static ] \
    && [ -f .next/server/middleware-manifest.json ] \
    && [ -f node_modules/next/package.json ]
}

# Schon ein vollständiges Prebuilt-Root?
if prebuilt_runtime_ok; then
  log "existing prebuilt server.js — light cleanup only"
  rm -rf "$HOME/.npm/_cacache" "$HOME/.npm/_logs" dist 2>/dev/null || true
  rm -f /tmp/pv-dash-prebuilt-*.tgz "$PWD/pv-dash-prebuilt.tgz" 2>/dev/null || true
  # $HOME/pv-dash-prebuilt.tgz bewusst behalten (start-restore nach npm prune).
  preserve_data
  log "version=$(cat .prebuilt-version) home-tarball=$([ -f "$HOME/pv-dash-prebuilt.tgz" ] && echo yes || echo no)"
  exit 0
fi

if [ -f server.js ] || [ -f .prebuilt-version ]; then
  log "prebuilt unvollständig (server/static/manifest/next) — erneuter Extract"
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
  • GitHub Release v${VERSION:-X.Y.Z} Asset pv-dash-prebuilt.tgz
    (privates Repo: Jelastic-Env GITHUB_RELEASE_TOKEN setzen — siehe DEPLOY.md)
  • oder Datei ~/ROOT/pv-dash-prebuilt.tgz

Sofort per Web-SSH (Workaround, privates Repo):
  cd ~/ROOT
  TOKEN="\$GITHUB_RELEASE_TOKEN"   # oder PAT einsetzen
  TAG="v${VERSION:-X.Y.Z}"
  META=\$(mktemp)
  curl -fsSL -H "Authorization: Bearer \$TOKEN" -H "Accept: application/vnd.github+json" \\
    -o "\$META" "https://api.github.com/repos/FloWal-Bit/PV-Dash/releases/tags/\$TAG"
  AID=\$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(next(a['id'] for a in d['assets'] if a['name']=='pv-dash-prebuilt.tgz'))" "\$META")
  curl -fsSL -L -H "Authorization: Bearer \$TOKEN" -H "Accept: application/octet-stream" \\
    -o /tmp/pv-dash-prebuilt.tgz \\
    "https://api.github.com/repos/FloWal-Bit/PV-Dash/releases/assets/\$AID"
  rm -f "\$META"
  cp -f /tmp/pv-dash-prebuilt.tgz ~/pv-dash-prebuilt.tgz
  mkdir -p /tmp/pb && tar -xzf /tmp/pv-dash-prebuilt.tgz -C /tmp/pb
  rsync -a --delete --exclude '.data/' --exclude '.env' --exclude '.env.*' --exclude 'scripts/' /tmp/pb/ ~/ROOT/
  rm -rf /tmp/pb /tmp/pv-dash-prebuilt.tgz
  # Danach Knoten neu starten (start.sh restored nach npm-prune)

Notfall (teuer): ALLOW_LEGACY_BUILD=1 bash ~/ROOT/scripts/jelastic-postdeploy.sh
EOF
exit 1
