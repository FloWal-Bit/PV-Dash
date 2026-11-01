#!/bin/bash
# Post-Deploy-Hook für Infomaniak Jelastic Cloud.
# Im Deploy-Dialog unter "Hooks" → Post am besten nur aufrufen:
#   bash ~/ROOT/scripts/jelastic-postdeploy.sh
# Dann greifen Updates aus Git automatisch. Alternativ den gesamten Inhalt
# hier einfügen (dann nach Änderungen am Skript den Hook manuell aktualisieren).
#
# Wird nach jedem Git-Deploy ausgeführt, bevor der Node.js-Container neu
# startet und `npm start` aufruft.
set -euo pipefail
cd ~/ROOT

available_mb=$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
echo "[postdeploy] MemAvailable≈${available_mb} MB"

# npm install + next build brauchen real ~2 GB freien RAM. Weniger → Exit 137 (Killed).
# Bei Infomaniak: Scaling Limit der Node-Schicht auf mind. ~24 Cloudlets (≈3 GB RAM)
# setzen; Reserved darf niedriger bleiben (Laufzeit), Limit muss den Build abdecken.
MIN_AVAILABLE_MB=1800
if [ "$available_mb" -lt "$MIN_AVAILABLE_MB" ]; then
  echo "[postdeploy] ERROR: Zu wenig RAM für npm install / next build (${available_mb} MB frei, braucht ≥${MIN_AVAILABLE_MB} MB)." >&2
  echo "[postdeploy] In Jelastic bei Anwendungsserver die Cloudlets erhöhen (Scaling Limit ≈ 24+ / ~3 GB)," >&2
  echo "[postdeploy] dann erneut Veröffentlichen. Exit 137 = OOM-Kill durch zu kleinen Container." >&2
  exit 137
fi

# Node-Heap an verfügbaren RAM anpassen (nicht höher erzwingen als vorhanden).
heap_mb=$((available_mb * 60 / 100))
if [ "$heap_mb" -lt 1536 ]; then heap_mb=1536; fi
if [ "$heap_mb" -gt 4096 ]; then heap_mb=4096; fi
# Sicherheitspuffer: Heap nie über MemAvailable − 400 MB
max_heap=$((available_mb - 400))
if [ "$max_heap" -lt 1024 ]; then max_heap=1024; fi
if [ "$heap_mb" -gt "$max_heap" ]; then heap_mb=$max_heap; fi
export NODE_OPTIONS="--max-old-space-size=${heap_mb}"
echo "[postdeploy] NODE_OPTIONS=${NODE_OPTIONS}"

# Install all deps (incl. @types/*). Container NODE_ENV=production would
# otherwise skip devDependencies and break Tailwind/TypeScript at build time.
npm install --include=dev
export NODE_ENV=production
npm run build
