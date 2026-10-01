#!/bin/bash
# Post-Deploy-Hook für Infomaniak Jelastic Cloud (im Deploy-Dialog unter
# "Hooks" → Post einfügen). Wird nach jedem Git-Deploy ausgeführt, bevor
# der Node.js-Container neu startet und `npm start` aufruft.
set -euo pipefail
cd ~/ROOT
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"
# Install all deps (incl. @types/*). Container NODE_ENV=production would
# otherwise skip devDependencies and break Tailwind/TypeScript at build time.
npm install --include=dev
export NODE_ENV=production
npm run build
