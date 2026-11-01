#!/bin/bash
# Post-Deploy-Hook für Infomaniak Jelastic Cloud.
# Im Deploy-Dialog unter "Hooks" → Post:
#   bash ~/ROOT/scripts/jelastic-postdeploy.sh
set -euo pipefail
cd ~/ROOT

available_mb=$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
echo "[postdeploy] MemAvailable≈${available_mb} MB"

# Früher reichten ~5 Cloudlets (≈640 MB), wenn der Heap klein blieb (~768).
# Ein erzwungener 2-GB-Heap auf kleinem Container führt zu Exit 137.
# Ziel: mit ~700–1200 MB freiem RAM durchkommen; darunter klar abbrechen.
MIN_AVAILABLE_MB=500
if [ "$available_mb" -lt "$MIN_AVAILABLE_MB" ]; then
  echo "[postdeploy] ERROR: Nur ${available_mb} MB frei (braucht ≥${MIN_AVAILABLE_MB} MB)." >&2
  echo "[postdeploy] Reserved/Scaling erhöhen ODER laufenden Node-Prozess stoppen (hält RAM), dann erneut Veröffentlichen." >&2
  exit 137
fi

# Heap: ca. 55 % von MemAvailable, Deckel 512–1536 MB (nicht 2048+ erzwingen).
heap_mb=$((available_mb * 55 / 100))
if [ "$heap_mb" -lt 512 ]; then heap_mb=512; fi
if [ "$heap_mb" -gt 1536 ]; then heap_mb=1536; fi
max_heap=$((available_mb - 150))
if [ "$max_heap" -lt 384 ]; then max_heap=384; fi
if [ "$heap_mb" -gt "$max_heap" ]; then heap_mb=$max_heap; fi
export NODE_OPTIONS="--max-old-space-size=${heap_mb}"
export NEXT_TELEMETRY_DISABLED=1
export npm_config_audit=false
export npm_config_fund=false
echo "[postdeploy] NODE_OPTIONS=${NODE_OPTIONS}"

# Weniger parallele Downloads → niedrigerer Peak-RAM bei npm install.
npm install --include=dev --no-audit --no-fund --maxsockets=1
export NODE_ENV=production
npm run build
