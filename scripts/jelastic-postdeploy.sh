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

# Next.js-Build braucht deutlich mehr Heap als 768 MB. Ein fester niedriger
# --max-old-space-size löst SIGKILL aus, auch wenn der Container mehr RAM hat.
# Deshalb: Hälfte von MemAvailable, zwischen 2048 und 4096 MB.
available_mb=$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 2048)
heap_mb=$((available_mb / 2))
if [ "$heap_mb" -lt 2048 ]; then heap_mb=2048; fi
if [ "$heap_mb" -gt 4096 ]; then heap_mb=4096; fi
export NODE_OPTIONS="--max-old-space-size=${heap_mb}"
echo "[postdeploy] NODE_OPTIONS=${NODE_OPTIONS} (MemAvailable≈${available_mb} MB)"

# Install all deps (incl. @types/*). Container NODE_ENV=production would
# otherwise skip devDependencies and break Tailwind/TypeScript at build time.
npm install --include=dev
export NODE_ENV=production
npm run build
