#!/bin/bash
# Einmalig per Web-SSH ausführen, wenn die Umgebung „keine Speicherkapazität“ meldet:
#   bash ~/ROOT/scripts/jelastic-disk-cleanup.sh
#
# Löscht Build-Müll der alten On-Node-Builds. Belässt .data/ und .env*.
set -euo pipefail

ROOT="${1:-$HOME/ROOT}"
cd "$ROOT" 2>/dev/null || cd "$HOME" || true

echo "[cleanup] before:"
df -h "$HOME" 2>/dev/null || df -h / 2>/dev/null || true
du -sh "$ROOT" "$ROOT/node_modules" "$ROOT/.next" "$HOME/.npm" /tmp 2>/dev/null || true

# Alte Full-Builds (oft je 400–600 MB+)
rm -rf \
  "$ROOT/node_modules" \
  "$ROOT/.next" \
  "$ROOT/dist" \
  "$ROOT/.turbo" \
  "$ROOT/.swc" \
  "$ROOT/coverage" \
  "$ROOT/pv-dash-prebuilt.tgz" \
  2>/dev/null || true

# npm-/Yarn-Caches im Home (können mehrere GB werden)
rm -rf \
  "$HOME/.npm/_cacache" \
  "$HOME/.npm/_logs" \
  "$HOME/.cache/yarn" \
  "$HOME/.cache/node-gyp" \
  "$HOME/.local/share/pnpm/store" \
  2>/dev/null || true

# Temporäre Prebuilt-Downloads und npm-tmp
rm -rf /tmp/pv-dash-prebuilt-*.tgz /tmp/npm-* /tmp/prebuilt-extract* 2>/dev/null || true
find /tmp -maxdepth 1 -user "$(id -un)" -type d -name 'tmp.*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true

echo "[cleanup] after:"
df -h "$HOME" 2>/dev/null || df -h / 2>/dev/null || true
du -sh "$ROOT" "$HOME/.npm" /tmp 2>/dev/null || true
echo "[cleanup] OK — danach in Jelastic erneut Veröffentlichen (Prebuilt-Hook)."
