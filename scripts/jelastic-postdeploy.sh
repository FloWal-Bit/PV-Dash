#!/bin/bash
# Post-Deploy-Hook für Infomaniak Jelastic Cloud (im Deploy-Dialog unter
# "Hooks" → Post einfügen). Wird nach jedem Git-Deploy ausgeführt, bevor
# der Node.js-Container neu startet und `npm start` aufruft.
set -euo pipefail
cd ~/ROOT
npm install
npm run build
