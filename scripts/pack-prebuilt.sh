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

# Next standalone: `hostname = process.env.HOSTNAME || '0.0.0.0'`.
# Unter Jelastic/Linux ist HOSTNAME bereits der Container-Name → Bind falsch → 502.
# Auch wenn der Prozess mit bloßem `node server.js` startet (ohne start.sh).
if grep -q "process.env.HOSTNAME" dist/jelastic/server.js; then
  sed -i "s/process\\.env\\.HOSTNAME || ['\"]0\\.0\\.0\\.0['\"]/'0.0.0.0'/g" dist/jelastic/server.js
  echo "[pack] patched server.js listen host → hardcoded 0.0.0.0"
else
  echo "[pack] WARN: HOSTNAME-Zeile in server.js nicht gefunden" >&2
fi

# start.sh: Jelastic führt vor npm start oft `npm install` aus. Unser
# package.json listet absichtlich keine dependencies (sonst On-Node-Download /
# Cloudlets). npm install entfernt dann „extraneous“ Module inkl. next.
# Deshalb: falls next fehlt, aus ~/pv-dash-prebuilt.tgz wiederherstellen.
cat > dist/jelastic/start.sh <<'EOF'
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export NODE_ENV=production
# Nicht "${HOSTNAME:-…}": Jelastic setzt HOSTNAME auf den Container-Namen → 502.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"

# Stromkonto & Co. ausserhalb ROOT (überlebt Git-Publish / git clean).
# Darf den Start NIE abbrechen (EACCES auf ROOT/.data → sonst nodejs.service tot).
ensure_persistent_data() {
  local persist="${HOME}/pv-dash-persist/.data"
  mkdir -p "$persist" 2>/dev/null || true
  if [ -d .data ] && [ ! -L .data ]; then
    rsync -a .data/ "$persist/" 2>/dev/null || true
    # Nur ersetzen, wenn Persist befüllt aussieht bzw. Schreibrecht da ist.
    if rm -rf .data 2>/dev/null; then
      ln -sfn "$persist" .data 2>/dev/null || mkdir -p .data 2>/dev/null || true
    else
      echo "[start] WARN: ROOT/.data nicht löschbar (Rechte) — behalte Ordner, App startet trotzdem" >&2
    fi
  elif [ -L .data ]; then
    ln -sfn "$persist" .data 2>/dev/null || true
  else
    ln -sfn "$persist" .data 2>/dev/null || mkdir -p .data 2>/dev/null || \
      echo "[start] WARN: kein ROOT/.data anlegbar (EACCES) — whatwatt/Dev-Settings können fehlen" >&2
  fi
  return 0
}

restore_prebuilt_if_needed() {
  # Auch middleware-manifest prüfen — sonst startet Next und crasht mit MODULE_NOT_FOUND.
  if [ -f node_modules/next/package.json ] \
    && [ -f server.js ] \
    && [ -d .next/static ] \
    && [ -f .next/server/middleware-manifest.json ]; then
    return 0
  fi
  local tb=""
  for cand in "$HOME/pv-dash-prebuilt.tgz" "$PWD/pv-dash-prebuilt.tgz"; do
    if [ -f "$cand" ] && [ -s "$cand" ]; then
      tb="$cand"
      break
    fi
  done
  if [ -z "$tb" ]; then
    echo "[start] ERROR: Prebuilt unvollständig und kein pv-dash-prebuilt.tgz unter ~/ oder ROOT." >&2
    echo "[start] Fix: UPDATE_PACKAGES_ON_RESTART=false setzen und Tarball nach ~/ kopieren." >&2
    return 1
  fi
  echo "[start] Prebuilt unvollständig (npm prune / fehlendes .next/server?) — restore aus $tb" >&2
  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$tb" -C "$tmp"
  if [ ! -f "$tmp/server.js" ] \
    || [ ! -f "$tmp/node_modules/next/package.json" ] \
    || [ ! -f "$tmp/.next/server/middleware-manifest.json" ]; then
    echo "[start] ERROR: Artifact in $tb ist unvollständig." >&2
    rm -rf "$tmp"
    return 1
  fi
  # Nur fehlende Runtime-Teile — kein Full-Tree-Rsync (vermeidet supervisor-Restart-Loops).
  mkdir -p node_modules .next
  rsync -a "$tmp/node_modules/" "$PWD/node_modules/"
  rsync -a "$tmp/.next/" "$PWD/.next/"
  cp -f "$tmp/server.js" "$PWD/server.js"
  if [ -f "$tmp/start.sh" ]; then cp -f "$tmp/start.sh" "$PWD/start.sh"; fi
  if [ -f "$tmp/package.json" ]; then cp -f "$tmp/package.json" "$PWD/package.json"; fi
  if [ -f "$tmp/.prebuilt-version" ]; then cp -f "$tmp/.prebuilt-version" "$PWD/.prebuilt-version"; fi
  if [ -d "$tmp/public" ]; then mkdir -p public; rsync -a "$tmp/public/" "$PWD/public/"; fi
  rm -rf "$tmp"
  if [ ! -f node_modules/next/package.json ] \
    || [ ! -f .next/server/middleware-manifest.json ]; then
    echo "[start] ERROR: restore fehlgeschlagen (next/.next/server fehlt weiter)." >&2
    return 1
  fi
}

ensure_persistent_data || true
restore_prebuilt_if_needed
echo "[start] prebuilt node server.js PORT=$PORT HOSTNAME=$HOSTNAME"
exec node server.js
EOF
chmod +x dist/jelastic/start.sh

# Keine dependencies: verhindert teures On-Node-Download.
# start.sh stellt node_modules aus ~/pv-dash-prebuilt.tgz wieder her,
# nachdem Jelastics `npm install` die traced Modules als extraneous pruned.
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

cat > dist/jelastic/.npmrc <<'EOF'
omit=dev
audit=false
fund=false
prefer-offline=true
fetch-retries=0
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
