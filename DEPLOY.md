# Deploy (Infomaniak Jelastic) — Prebuilt

Ziel: **kein `npm run build` auf dem Node**, damit Dynamic Cloudlets und
Kosten niedrig bleiben. Der Build läuft auf GitHub Actions (oder lokal).

## Ablauf (Standard)

1. Änderungen nach `main` mergen (Version in `package.json` / `src/lib/version.ts` setzen).
2. Workflow **Prebuilt release** abwarten (grün) — erzeugt Release `vX.Y.Z` mit Asset `pv-dash-prebuilt.tgz`.
3. In Jelastic **Veröffentlichen** (Git-Sync + Post-Hook).
4. Post-Hook lädt das Release-Asset, entpackt es nach `~/ROOT`.
   Runtime-Daten liegen unter `~/pv-dash-persist/.data` (Symlink `~/ROOT/.data`),
   damit Git-Publish/Stromkonto die Werte nicht bei jedem Veröffentlichen löscht.

Post-Hook im Dashboard:

```bash
bash ~/ROOT/scripts/jelastic-postdeploy.sh
```

Start command (nach Prebuilt-Extract gilt das `package.json` im Artifact):

```bash
npm start
```

Das startet `start.sh` → zwingend `HOSTNAME=0.0.0.0 node server.js` (PORT von Jelastic).
Ohne festes `0.0.0.0` bindet Next an den Container-Hostnamen → **502** am Proxy.

**Wichtig — Jelastic-Variablen (sonst 502 nach ~30s):**

Im Panel → Node.js → **Umgebung / Variables** setzen:

| Variable | Wert | Warum |
| --- | --- | --- |
| `UPDATE_PACKAGES_ON_RESTART` | `false` | Sonst `npm install` bei jedem Restart → pruned Prebuilt-`node_modules` → `Cannot find module 'next'` |
| `PROCESS_MANAGER` | `npm` oder `forever` / `pm2` | **Nicht** `supervisor` — der restartet bei Dateiänderungen (Restore schreibt viele Dateien) |
| Start / `npm start` | `npm start` | Nutzt `start.sh` (Bind `0.0.0.0` + Restore-Fallback) |
| `GITHUB_RELEASE_TOKEN` | Fine-grained PAT | **Pflicht bei privatem Repo** — Post-Hook lädt Release-Assets über die GitHub-API |

### Privates GitHub-Repo

Sobald `FloWal-Bit/PV-Dash` privat ist, braucht der Post-Hook einen Token:

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Token erzeugen, z. B. `pv-dash-jelastic-releases`
   - Resource owner: dein Account
   - Repository access: nur `PV-Dash`
   - Permissions → Repository → **Contents: Read** (reicht für Releases/Assets)
   - Expiration nach Geschmack (z. B. 90 Tage) — vor Ablauf erneuern
3. In Jelastic unter Node.js → **Umgebung / Variables**:
   - Name: `GITHUB_RELEASE_TOKEN`
   - Wert: der PAT (nicht committen, nicht in `.env` im Repo)
4. Knoten neu starten / einmal **Veröffentlichen**, damit die Variable im Hook ankommt

Der Hook nutzt dann `GET /repos/.../releases/tags/vX.Y.Z` und lädt das Asset
`pv-dash-prebuilt.tgz` mit `Accept: application/octet-stream`. Ohne Token
schlägt der Download bei privatem Repo fehl (öffentlicher Browser-URL-Fallback
bleibt für den Fall, dass das Repo wieder public ist).

**Git-Sync (Veröffentlichen):** Infomaniak braucht für ein privates Repo ebenfalls
Zugang (Deploy Key oder HTTPS mit PAT als Passwort). Das ist unabhängig vom
Release-Token — beides einrichten, sonst zieht der Node keinen neuen Code.

Zusätzlich hält der Post-Hook `$HOME/pv-dash-prebuilt.tgz`; `start.sh` stellt daraus
`node_modules` wieder her, falls sie fehlen. Einmalig manuell (privates Repo):

```bash
# TOKEN = derselbe Wert wie GITHUB_RELEASE_TOKEN
TAG=vX.Y.Z
META=$(mktemp)
curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  -o "$META" "https://api.github.com/repos/FloWal-Bit/PV-Dash/releases/tags/$TAG"
AID=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(next(a['id'] for a in d['assets'] if a['name']=='pv-dash-prebuilt.tgz'))" "$META")
curl -fsSL -L -H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream" \
  -o ~/pv-dash-prebuilt.tgz \
  "https://api.github.com/repos/FloWal-Bit/PV-Dash/releases/assets/$AID"
rm -f "$META"
```

## Lokal packen (ohne CI)

```bash
npm run pack:prebuilt
# → dist/pv-dash-prebuilt.tgz
```

Varianten:

- Datei als `pv-dash-prebuilt.tgz` nach `~/ROOT` legen und Post-Hook laufen lassen, oder
- Inhalt von `dist/jelastic/` als Archive-Deploy hochladen.

## Notfall (teuer)

Wenn kein Artifact da ist und die App trotzdem gebaut werden muss:

```bash
ALLOW_LEGACY_BUILD=1 bash ~/ROOT/scripts/jelastic-postdeploy.sh
```

Das ist der alte Weg (`npm install` + `next build`) und treibt Dynamic Cloudlets.

## Reserved Cloudlets

Nach stabilem Prebuilt-Betrieb Reserved möglichst auf die **Runtime-Last**
senken (oft deutlich unter dem früheren Build-Peak). Nicht für den Build
reservieren — der findet ausserhalb statt.

## Disk voll („keine Speicherkapazität“)

Die App braucht im Prebuilt-Betrieb nur ~50–100 MB. Voll wird die Quota
durch alte On-Node-Builds (`node_modules` ~500 MB, `.next` ~400 MB, npm-Cache
oft GB).

Sofort per **Web-SSH**:

```bash
bash ~/ROOT/scripts/jelastic-disk-cleanup.sh
# Falls das Skript noch nicht auf dem Node ist:
rm -rf ~/ROOT/node_modules ~/ROOT/.next ~/.npm/_cacache /tmp/pv-dash-prebuilt-*.tgz
df -h ~
```

Danach erneut **Veröffentlichen**. Der Post-Hook räumt Legacy-Müll künftig
selbst vor dem Extract weg.
