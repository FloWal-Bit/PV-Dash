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

### Privates GitHub-Repo — Reihenfolge (wichtig)

**Nie zuerst privat schalten.** Sonst löscht Git-Sync `ROOT` und der Hook
bekommt 401. Dauer: ca. 10 Minuten, wenn die Schritte **in dieser Ordnung** laufen.

| Schritt | Wo | Was |
| --- | --- | --- |
| 1 | GitHub | Fine-grained PAT: nur Repo `PV-Dash`, Permission **Contents: Read** |
| 2 | Jelastic → Git-Projekt / Repository | URL `https://github.com/FloWal-Bit/PV-Dash.git`, Ast `main`, **Authentifizierung an**, Benutzer `FloWal-Bit`, Passwort = **derselbe PAT** |
| 3 | Jelastic → Node Variables | `GITHUB_RELEASE_TOKEN` = **derselbe PAT** (Hook lädt Release-Assets) |
| 4 | GitHub / Jelastic | Sicherstellen, dass mindestens **v1.5.7.38** (oder neuer) deployed ist: resilient `start.sh` + Token-Fallback im Hook |
| 5 | Test | Einmal **Veröffentlichen** solange das Repo noch **öffentlich** ist — Tasks grün, Seite ok |
| 6 | GitHub | Erst jetzt: Settings → Danger Zone → **Make private** |
| 7 | Jelastic | Nochmal **Veröffentlichen** + Knoten-Restart |

Ein PAT reicht für **Git-Sync und Release-Download**. Nicht committen, nicht in `.env`.

**Zurück auf öffentlich:** Variable `GITHUB_RELEASE_TOKEN` darf bleiben; ab v1.5.7.38
fällt der Hook bei 401 automatisch auf den öffentlichen Download zurück. Ungültigen
Token trotzdem löschen, damit die Logs klar bleiben.

**Git-Sync ohne Auth bei privatem Repo** → `ROOT` weg, 502. Immer Auth **vor**
Sichtbarkeitswechsel setzen und einmal testen.

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

## Nachtpause & Abruf-Budget (Europe/Zurich)

Betrieb: Node typisch **23:30–06:00** aus (Infomaniak-Kosten). Ab v1.5.8.2:

1. **Client:** in der Pause kein 15‑s-Poll mehr — nur ~**20‑Min-Probe** (bzw. kurz nach 06:00), History pausiert bis Live wieder ok.
2. **Client Schlaf-Snapshot:** ca. **3 min vor 23:30** einmal Live + History → Offline-Cache (localStorage), damit die Nachtanzeige frisch ist.
3. **Server:** beim ersten Request nach Prozessstart **ein** sequentieller Catch-up
   (FusionSolar Live → Heute → Ranges → Laufzeit → Open-Meteo → Wetter-Alarm Heute/Morgen),
   parallele Tabs warten auf denselben Warmup. Wetter-Alarm nicht erst auf die
   Client-Marke 06:00 warten.

Dieselbe Übersicht steht in den **Dev Settings** (App) und in
`src/lib/fetch-budget.ts` (Quelle der Wahrheit für die UI).

| Daten / Quelle | Intervall | Feste Uhrzeiten? | ≈/Tag* | Anzeige (Card / Tab) |
| --- | --- | --- | --- | --- |
| Browser → `/api/pv` | 15 s; in Pause ~20 min Probe | Pause 23:30–06:00 | tagsüber hoch, nachts ~20 Probes | treibt Live (Card 1–3, KPIs, Header) |
| Browser → `/api/pv/history` | 15 min; in Pause aus | — | ~68 (ohne Pause-Nacht) | **Card 3** alle Tabs |
| FusionSolar Login | 25 min | nein | ~40 (ohne Pause) | nicht sichtbar |
| FusionSolar Live RealKpi | 6 min Cache | nein | ~175 Zyklen (ohne Pause) | **Card 2**, Header, KPI Ertrag |
| FusionSolar Heute `getDevFiveMinutes` | 45 min (06–23), 3 h (23–06) | Fenster 06/23 | ~23 + Catch-up; nachts oft 0 wenn Node aus (Limit 25) | **Card 3 → Heute** |
| FusionSolar Zähler 5‑Min | 1×/Tag | erster Bedarf | 1 | **Card 3 → Heute** Verbrauchslücken |
| FusionSolar Woche/Monat / Year | 12 h; Catch-up einmal nach Start | ~06:00 Warmup | ~2 + Catch-up | **Card 3** Woche–Laufzeit |
| whatwatt MQTT | Push | nein | 0 Polls | **Card 2**, KPIs Stromkonto/Verbrauch |
| Open-Meteo | 45 min; Catch-up nach Start | — | ~32 | **Card 1** Prognose |
| Wetter-Alarm | Marken + Catch-up | **06 / 12 / 18 / 23** (+ Warmup ~06:00) | 4 Marken + Start | **Card 1** Wetter/Sonne |
| Nachtpause Node | aus | **23:30–06:00** | — | Banner; keine FusionSolar-Aufrufe wenn Node aus |
| Startup-Catch-up | 1× / Prozess | nach Hochfahren (~06:00) | 1 Sequenz (FusionSolar→OM→WA) | Caches Card 1–3 |
| Schlaf-Snapshot (Client) | 1× / Abend | ~**23:27** (3 min vor Pause) | 1× Live+History | Offline-Cache für die Nacht |

\*Bei dauerhaft laufendem Node + offenem Dashboard; Pause verkürzt die Nachtwerte.

## Crash: `middleware-manifest.json` fehlt

Symptom: Log zeigt
`Cannot find module '.../ROOT/.next/server/middleware-manifest.json'`,
die URL antwortet mit `Internal Server Error`.

Ursache: unvollständiges Prebuilt (z. B. nur `server.js` + `.next/static`),
während der Post-Hook fälschlich „schon installiert“ annahm.

Sofort (ohne Code-Change), im Jelastic **Config / Dateimanager** oder Web-SSH:

```bash
rm -f ~/ROOT/.prebuilt-version
# optional, erzwingt klaren Extract:
# rm -rf ~/ROOT/.next ~/ROOT/server.js
```

Danach erneut **Veröffentlichen**. Der Hook lädt das Release neu und extrahiert vollständig.
Ab v1.5.7.36 prüft der Hook `middleware-manifest.json` mit.

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
