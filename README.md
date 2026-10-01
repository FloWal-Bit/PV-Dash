# PV Dash

Eine schlichte, intuitive Web-App zur Anzeige von PV-Daten (Photovoltaik):
aktuelle Erzeugung, Verbrauch, Netzbezug/-einspeisung, Speicherstand,
Tagesertrag, Gesamtertrag, Eigenverbrauchsquote und Autarkiegrad – live
aktualisiert, ergänzt um Sonnenauf-/-untergang und die prognostizierten
Sonnenstunden für den Standort.

Die App ist als responsive Progressive-Web-App (PWA) gebaut und läuft im
Browser auf **Android und iOS** sowie auf Desktop, im Hoch- **und**
Querformat. Auf dem Smartphone kann sie über "Zum Startbildschirm
hinzufügen" (iOS Safari) bzw. "App installieren" (Android Chrome) wie eine
native App installiert werden.

## Projektbeschrieb

**Ziel:** Ein Dashboard, das über eine URL aufgerufen werden kann und die
Ertragsdaten der eigenen PV-Anlage anzeigt – als schlanke Alternative/Ergänzung
zur Huawei Solar App, die aktuell zur Anlagenüberwachung genutzt wird.

**Voraussetzungen / Anforderungen:**

- Aufruf per URL (Web-Dashboard, kein nativer App-Store-Download nötig).
- Anzeige der Ertragsdaten der PV-Anlage (aktuell, heute, Verlauf) –
  Datenquelle ist die Huawei FusionSolar-Anbindung (siehe
  [Datenquelle](#datenquelle) unten), dieselbe Anlage, die auch in der
  Huawei Solar App zu sehen ist.
- Schlichtes, intuitives UI; funktioniert im Hoch- **und** Querformat.
- Läuft auf **Android und iOS** – insbesondere auch gut lesbar auf einem
  **Android-Tablet**, auf dem das Dashboard dauerhaft angezeigt werden soll.
- Ideen und geplante Erweiterungen liegen im **Backlog der App**
  (Listen-Symbol in der Kopfzeile). Erster Punkt: Modbus TCP im Dongle
  aktivieren.

## Tech-Stack

- [Next.js](https://nextjs.org/) (App Router) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) v4
- [shadcn/ui](https://ui.shadcn.com/) Komponenten
- [Recharts](https://recharts.org/) für Verlaufs-Diagramme
- [next-themes](https://github.com/pacocoursey/next-themes) für Hell-/Dunkelmodus

## Datenquelle

Die App unterstützt zwei Datenquellen und wählt automatisch die beste
verfügbare:

1. **Huawei FusionSolar** (Northbound API) – echte Live-Daten deiner Anlage,
   sobald Zugangsdaten hinterlegt sind (siehe unten).
2. **Simulation** – realistische PV-Daten anhand der aktuellen Uhrzeit
   (Tageskurve, Wetter-Einfluss, Batterieverhalten), falls FusionSolar nicht
   konfiguriert ist oder gerade nicht erreichbar ist. Die App bleibt so
   immer benutzbar. Simulationslogik: [`src/lib/pv-data.ts`](src/lib/pv-data.ts).

Ein Server-Endpunkt (`GET /api/pv`, siehe
[`src/app/api/pv/route.ts`](src/app/api/pv/route.ts)) liefert in beiden
Fällen dieselbe Datenform; welche Quelle aktiv ist, zeigt das Badge oben
rechts im Header ("FusionSolar" bzw. "Simulation") sowie die Fußzeile an.
Optional lässt sich zusätzlich ein **whatwatt Go** (per MQTT) einbinden, das
nur die Netzbezug-/Einspeisungswerte beider Quellen mit präziseren
Live-Messwerten überschreibt (siehe
["whatwatt Go-Anbindung"](#whatwatt-go-anbindung-netzbezug-einspeisung-per-mqtt)
unten) – ein zweites Badge "whatwatt Go" zeigt das dann an.

### FusionSolar-Anbindung einrichten

Die Anbindung nutzt die **Northbound API** von FusionSolar (nicht das normale
Portal-Login). Du benötigst ein dediziertes API-Konto:

1. Im FusionSolar-Portal (Rolle Anlagenbesitzer/Installateur) unter
   *Systemverwaltung → Nordkanal (Northbound)-API-Konten* ein neues Konto
   anlegen und der Anlage zuweisen.
2. Die Region-URL deines Kontos notieren (z. B.
   `https://region01eu5.fusionsolar.huawei.com` für Europa oder
   `https://intl.fusionsolar.huawei.com` international) – sie steht meist in
   der Adressleiste, wenn du im Portal eingeloggt bist.
3. Folgende Werte als **Secrets** hinterlegen (Cursor-Dashboard →
   Cloud Agents → Secrets, oder lokal in einer nicht committeten
   `.env.local`, siehe [`.env.example`](.env.example)):

   | Variable | Bedeutung |
   |---|---|
   | `FUSIONSOLAR_BASE_URL` | Basis-URL der Region, ohne Pfad/Slash am Ende |
   | `FUSIONSOLAR_USERNAME` | Benutzername des Northbound-API-Kontos |
   | `FUSIONSOLAR_SYSTEM_CODE` | Passwort des Northbound-API-Kontos (von Huawei "systemCode" genannt) |
   | `FUSIONSOLAR_STATION_CODE` | Optional: feste Anlagen-ID, falls das Konto mehrere Anlagen verwaltet |

4. Sobald die drei Pflichtwerte gesetzt sind (Neustart der App/des Agents
   nötig, damit die Umgebungsvariablen geladen werden), holt sich `/api/pv`
   automatisch echte Daten. Schlägt der Login oder ein Abruf fehl (falsche
   Zugangsdaten, Anlage offline, Ratenlimit), erscheint eine gelbe Hinweisleiste
   im Dashboard und die App zeigt übergangsweise simulierte Daten.

**Wichtig zu FusionSolars Ratenlimits:** Ein Northbound-API-Konto darf
Echtzeitdaten (`getStationRealKpi`) praktisch nur alle ~5 Minuten abrufen und
Verlaufsdaten (stündlich/täglich/monatlich/jährlich) nur ~24×/Tag – unabhängig
davon, wie oft das Dashboard im Browser pollt. Der Server cacht deshalb selbst
([`src/lib/fusionsolar/service.ts`](src/lib/fusionsolar/service.ts)): Live-KPIs
werden höchstens alle 6 Minuten neu von FusionSolar geholt, Stunden-/Tagesdaten
höchstens einmal pro Stunde und die Jahresdaten für die "Lebensdauer"-Ansicht
(`getKpiStationYear`) höchstens alle 6 Stunden, da sie sich innerhalb eines
Tages ohnehin kaum ändern. Der Browser pollt trotzdem alle 5 Sekunden – er
bekommt dabei aber meist den Server-Cache, nicht einen neuen FusionSolar-Call.

**Bekannte Einschränkungen:** FusionSolar liefert Momentanleistung nur pro
Wechselrichter-Gerät (`active_power`, kW) und Ertrags-/Verbrauchssummen pro
Anlage (kWh) zuverlässig. Ohne einen separat registrierten Netz-/Smart-Meter
(devTypeId 17/47) kennt die App den aktuellen Hausverbrauch bzw. Netzbezug in
kW nicht – die entsprechenden Kacheln zeigen dann "–" statt einer Zahl, statt
einen falschen Wert zu erfinden. Ebenso werden Batteriewerte nur angezeigt,
wenn FusionSolar ein Speichergerät (devTypeId 39) meldet. Die genaue Einheit
der stündlichen/täglichen Verlaufsfelder ist in Huaweis Doku nicht
spezifiziert (aktuell als Wh angenommen, siehe Kommentar in
[`src/lib/fusionsolar/mapper.ts`](src/lib/fusionsolar/mapper.ts)) – nach dem
ersten Live-Test mit echten Zahlen ggf. anpassen. Die Verlaufs-Diagramme
(Woche/Monat/Lebensdauer) zeigen zusätzlich, wie sich der Verbrauch
zusammensetzt ("Direkt von PV" vs. "Aus Speicher"); da FusionSolars
Tages-/Monats-/Jahreswerte das nicht direkt liefern, ist das eine grobe
Näherung (siehe `splitConsumptionApprox` in `mapper.ts`) – ohne erkanntes
Speichergerät wird korrekt kein Speicheranteil erfunden. Die
"Lebensdauer"-Ansicht (ein Balkenpaar pro Jahr seit Inbetriebnahme) benötigt
zusätzlich die Berechtigung für `getKpiStationYear`; fehlt sie beim
FusionSolar-Konto, bleibt dieser Tab leer, statt den restlichen Datenabruf zu
blockieren.

### whatwatt Go-Anbindung (Netzbezug/-einspeisung) per MQTT

Zusätzlich zur Haupt-Datenquelle (FusionSolar/Simulation) kann optional ein
[whatwatt Go](https://whatwatt.tech/) eingebunden werden – ein kleiner
Smart-Meter-Adapter, der direkt am Stromzähler die tatsächliche
Netzbezugs-/Einspeiseleistung misst. Das ist besonders dann nützlich, wenn
die PV-Anlage/der Wechselrichter selbst (noch) keinen Netz-/Smart-Meter
registriert hat und die entsprechenden FusionSolar-Kacheln deshalb "–"
zeigen (siehe "Bekannte Einschränkungen" oben).

Die Anbindung läuft bewusst über **MQTT statt eines direkten HTTP-Abrufs**:
Das Gerät verbindet sich selbst (ausgehend) zu einem MQTT-Broker im Internet
und veröffentlicht dort laufend seine Messwerte; diese App abonniert
denselben Broker. Dadurch funktioniert die Anbindung auch, wenn das
Dashboard **cloud-gehostet** läuft und nicht im selben lokalen Netzwerk wie
das Gerät steht – es muss keine Portfreigabe am Router eingerichtet werden,
da die Verbindung immer vom Gerät ausgeht.

**Voraussetzungen:**

- Ein (kostenloser) MQTT-Broker im Internet, erreichbar sowohl vom
  whatwatt Go als auch vom Dashboard-Server aus. Empfehlung:
  [HiveMQ Cloud](https://www.hivemq.com/mqtt-cloud-broker/) (Free-Tarif
  reicht für ein einzelnes Gerät völlig aus).
- Eine **Plus-Lizenz** (oder höher) auf dem whatwatt Go, da MQTT-Publishing
  sonst nicht verfügbar ist.

**1. MQTT-Broker einrichten (Beispiel HiveMQ Cloud):**

1. Kostenlosen Account und einen Cluster anlegen.
2. Unter "Access Management" einen Nutzer mit Benutzername/Passwort
   anlegen (wird sowohl vom Gerät als auch vom Dashboard-Server verwendet).
3. Die Cluster-URL notieren, z. B. `<cluster-id>.s1.eu.hivemq.cloud`, Port
   `8883` (MQTT über TLS).

**2. whatwatt Go konfigurieren** (lokale WebUI des Geräts → Abschnitt MQTT):

| Feld | Wert |
|---|---|
| Enabled | ein |
| URL | `mqtts://<cluster-id>.s1.eu.hivemq.cloud:8883` |
| Username / Password | dein HiveMQ-Nutzer |
| Client ID | ein eindeutiger Wert, z. B. `whatwatt-go-<deine-geraete-id>` |
| Publish Topic | frei wählbar, z. B. `PVDash` |
| Payload Template | whatwatt-Standardbeispiel reicht (siehe unten) |

**Payload-Template:** PV Dash versteht das **Standardbeispiel aus der
whatwatt-Doku** – du musst am Gerät nichts Spezielles anpassen:

```json
{
  "P_In": ${1_7_0},
  "P_Out": ${2_7_0},
  "E_In": ${1_8_0},
  "E_Out": ${2_8_0},
  "Meter": {
    "DateTime": "${meter.date_time}"
  },
  "Sys": {
    "Id": "${sys.id}"
  }
}
```

Alternativ funktioniert auch das flache Template mit `powerInKw`/`energyInKwh`
(siehe [`src/lib/whatwatt/parse.ts`](src/lib/whatwatt/parse.ts)).

**3. App konfigurieren** – folgende Werte als Secrets hinterlegen (siehe
[`.env.example`](.env.example)):

| Variable | Bedeutung |
|---|---|
| `WHATWATT_MQTT_URL` | Broker-URL inkl. Protokoll/Port, z. B. `mqtts://<cluster-id>.s1.eu.hivemq.cloud:8883` |
| `WHATWATT_MQTT_USERNAME` / `WHATWATT_MQTT_PASSWORD` | Broker-Zugangsdaten (derselbe Nutzer wie beim Gerät, oder ein zweiter mit Lesezugriff auf das Topic) |
| `WHATWATT_MQTT_TOPIC` | Muss exakt dem "Publish Topic" am Gerät entsprechen, z. B. `pv-dash/grid` |

Sind alle vier Variablen gesetzt, baut die App beim ersten Bedarf eine
dauerhafte Abo-Verbindung zum Broker auf (siehe
[`src/lib/whatwatt/service.ts`](src/lib/whatwatt/service.ts)) und
überschreibt `gridKw`, `gridImportTodayKwh` und `gridFeedInTodayKwh` im
Snapshot, sobald die erste Nachricht eintrifft; ein "whatwatt Go"-Badge im
Header sowie die Fußzeile zeigen das an. Sind die Variablen nicht gesetzt
oder kommen länger als 5 Minuten keine Nachrichten an, bleiben die
Netzwerte der Hauptquelle unverändert – der restliche Dashboard-Abruf
schlägt dadurch nie fehl.

**Wichtige Einschränkungen:**

- whatwatt Go liefert Energie nur als seit Zählerstart **kumulierten
  Gesamtwert** (`energyInKwh`/`energyOutKwh`), keinen fertigen Tageswert.
  Die App leitet daraus "heute" ab, indem sie sich pro Kalendertag den
  zuerst beobachteten Zählerstand als Basislinie merkt und spätere Werte
  davon abzieht (siehe [`src/lib/whatwatt/mapper.ts`](src/lib/whatwatt/mapper.ts)).
  Diese Basislinie lebt nur im Server-Prozessspeicher: Ein Neustart des
  Dashboard-Servers mitten am Tag setzt sie zurück, wodurch der Tageswert
  de facto neu bei 0 beginnt. Für einen produktionsreiferen Einsatz sollte
  die Basislinie stattdessen in einer kleinen Datei/DB persistiert werden.
- Die Abo-Verbindung zum Broker ist an den Node-Prozess gebunden – siehe
  ["Hosting auf Infomaniak Jelastic Cloud"](#hosting-auf-infomaniak-jelastic-cloud-empfohlen)
  unten für Anforderungen an die Hosting-Plattform.

### Sonnenauf-/-untergang & Sonnenstunden

Unabhängig von der Datenquelle (FusionSolar oder Simulation) zeigt das
Dashboard Sonnenaufgang, Sonnenuntergang und die für den Tag prognostizierten
Sonnenstunden für einen Standort – berechnet rein astronomisch mit
[`suncalc`](https://github.com/mourner/suncalc) (siehe
[`src/lib/sun.ts`](src/lib/sun.ts)). Die "Sonnenstunden" sind dabei bewusst
keine 1:1-Kopie der reinen Tageslänge, sondern werden um einen (für die Demo
simulierten) Bewölkungsfaktor reduziert, damit der Wert eine plausible
Sonnenschein-Prognose statt nur der astronomischen Tageslänge abbildet.

Standardmäßig ist der Standort **Bätterkinden** (47.1316° N, 7.5382° E) –
passend zur Anlage Kronenmatte 3. Für einen anderen Einsatzort entweder in den
**Einstellungen** (Zahnrad → Standort) anpassen (wird im Browser gespeichert)
oder beim Deployment optional `NEXT_PUBLIC_SITE_LATITUDE` und
`NEXT_PUBLIC_SITE_LONGITUDE` setzen (siehe [`.env.example`](.env.example)).

Aus den prognostizierten Sonnenstunden und der Anlagenleistung (kWp) leitet
die App zusätzlich einen **prognostizierten Tagesertrag** ab (Sonnenstunden ×
kWp × 80 % Performance Ratio, um reale Verluste abzubilden). Die Kachel
"Kennzahlen" zeigt den bereits erzielten Ertrag im Vergleich dazu als
Fortschrittsbalken (`estimateForecastedYieldKwh` in
[`src/lib/sun.ts`](src/lib/sun.ts)).

### Backlog

Über das Listen-Symbol in der Kopfzeile öffnet sich das Ideen-Backlog.
Neue Punkte oben eintippen und mit Enter oder „Hinzufügen“ ablegen.
Offene Einträge lassen sich als erledigt markieren oder löschen.
Gespeichert wird serverseitig in `.data/backlog.json` (liegt nicht im Git).

### Einstellungen (Standort & Benachrichtigungen)

Über das Zahnrad-Symbol im Header öffnet sich ein Einstellungen-Dialog mit
zwei Gruppen:

- **Standort:** Bezeichnung, Breiten- und Längengrad für Sonnenauf-/-untergang
  und Sonnenstunden-Prognose. Standard ist Bätterkinden; per „Standard“-Button
  jederzeit zurücksetzbar (siehe [`src/lib/site-location.ts`](src/lib/site-location.ts)).
- **Benachrichtigungen:** Push-Benachrichtigung
aktivieren, die auslöst, sobald die Anlage an einem Tag mehr als
`YIELD_NOTIFICATION_THRESHOLD_KWH` (Standard: 3 kWh) erzeugt hat – höchstens
einmal pro Kalendertag (siehe [`src/lib/notifications.ts`](src/lib/notifications.ts)).

Das läuft komplett client-seitig über die Browser-Notification-API, ohne
eigenen Push-Server: Beim Aktivieren fragt die App die Benachrichtigungs-
Berechtigung des Browsers an; ist sie erteilt, prüft das Dashboard bei jedem
Datenabruf (alle 5 s), ob die Schwelle überschritten wurde. Das setzt voraus,
dass das Dashboard geöffnet ist (Tab im Vorder- oder Hintergrund) – echte
Server-Push-Benachrichtigungen bei geschlossener App würden zusätzlich einen
Service Worker mit Push-Abo sowie einen Push-Server (z. B. via VAPID-Keys)
erfordern. Im Einstellungen-Dialog gibt es zum Testen einen Button
"Testbenachrichtigung senden", der unabhängig vom Schwellenwert sofort eine
Beispielmeldung auslöst.

## Lokal starten

```bash
npm install
npm run dev
```

Die App läuft danach unter `http://localhost:47823`.

Für einen Produktions-Build:

```bash
npm run build
npm run start
```

### Hosting auf Infomaniak Jelastic Cloud (empfohlen)

Da whatwatt Go per MQTT angebunden ist (siehe oben), muss der Dashboard-
Server **nicht** im selben lokalen Netzwerk wie das Gerät laufen – er kann
in der Cloud gehostet werden und ist von überall per URL erreichbar.

**Empfehlung:** [Infomaniak Jelastic Cloud](https://www.infomaniak.com/de/hosting/dedicated-and-cloud-servers/jelastic-cloud) – Schweizer PaaS (Rechenzentren Genf/Zürich, DSGVO), Git-Deploy, expliziter Next.js-Support, 14 Tage kostenlose Testphase.

**Wichtig:** Die App braucht einen **dauerhaft laufenden Node-Prozess**
(FusionSolar-Session + MQTT-Abo-Verbindung im Arbeitsspeicher) – **nicht**
Vercel/Serverless. Jelastic erfüllt das; `npm start` läuft als normaler
Container-Prozess.

#### Voraussetzungen

- Infomaniak-Konto + Jelastic Cloud (14 Tage Test: 8 Cloudlets ≈ 1 GB RAM,
  10 GB SSD – reicht zum Ausprobieren)
- Git-Repository mit diesem Projekt (GitHub/GitLab/Bitbucket)
- FusionSolar- und whatwatt-MQTT-Werte aus [`.env.example`](.env.example)
- Optional: HiveMQ Cloud als MQTT-Broker (siehe whatwatt-Abschnitt oben)

#### Schritt 1 – Jelastic-Umgebung anlegen

1. [Infomaniak Manager](https://manager.infomaniak.com/) → **Jelastic Cloud** → Test starten bzw. Credits laden.
2. **Neue Umgebung** erstellen:
   - **Node.js** als Anwendungsserver (Node 20 oder 22)
   - **NGINX** als Load Balancer davor (empfohlen – leitet HTTP auf den Node.js-Port weiter)
   - Region: Schweiz
3. **Cloudlets** (1 Cloudlet = 128 MB RAM + 400 MHz CPU):
   - Zum Testen: **4 reservierte** Cloudlets (512 MB) – ausreichend für Next.js + MQTT
   - Sparsamer Start: **2 reservierte** (256 MB) – kann knapp werden; bei Speicherproblemen auf 4 erhöhen
   - Dynamische Cloudlets: 0–2 (für Lastspitzen, nachts meist irrelevant)

> **Testphase:** Keine eigene Public IP / kein Custom-SSL – die Standard-Jelastic-URL (`https://<dein-env>.…`) funktioniert trotzdem. Eigene Domain und feste IP erst ab bezahltem Konto.

#### Schritt 2 – Code deployen (Git)

1. In der Umgebung: **Deploy** → **Git/SVN** → Repository-URL eintragen
   (bei privatem Repo: Access Token als Passwort).
2. Branch: `main` (oder dein Feature-Branch).
3. Deploy-Ziel: **ROOT**-Kontext auf dem Node.js-Container.
4. Unter **Hooks → Post-Deploy** einfügen (Inhalt aus
   [`scripts/jelastic-postdeploy.sh`](scripts/jelastic-postdeploy.sh)):

```bash
cd ~/ROOT
npm install
npm run build
```

5. Deploy starten. Jelastic führt `npm install` + Build aus; danach startet
   der Container automatisch mit `npm start` (Process Manager: **npm**).

#### Schritt 3 – Umgebungsvariablen setzen

Im Jelastic-Dashboard → Node.js-Container → **Variablen**:

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `FUSIONSOLAR_BASE_URL` | ja* | Region-URL ohne Slash |
| `FUSIONSOLAR_USERNAME` | ja* | Northbound-API-Benutzer |
| `FUSIONSOLAR_SYSTEM_CODE` | ja* | Northbound-API-Passwort |
| `FUSIONSOLAR_STATION_CODE` | nein | Feste Anlagen-ID |
| `WHATWATT_MQTT_URL` | nein | z. B. `mqtts://….hivemq.cloud:8883` |
| `WHATWATT_MQTT_USERNAME` | nein | Broker-Nutzer |
| `WHATWATT_MQTT_PASSWORD` | nein | Broker-Passwort |
| `WHATWATT_MQTT_TOPIC` | nein | z. B. `pv-dash/grid` |
| `NEXT_PUBLIC_SITE_LATITUDE` | nein | Standort (Sonnenzeiten) |
| `NEXT_PUBLIC_SITE_LONGITUDE` | nein | Standort (Sonnenzeiten) |

\*Ohne FusionSolar-Werte läuft die App mit simulierten Daten.

Container danach **neu starten**, damit die Variablen wirksam werden.

#### Schritt 4 – NGINX auf Node.js-Port einstellen

Der Load Balancer muss auf den Port zeigen, den Next.js nutzt (Jelastic setzt
`PORT` automatisch; unsere App liest ihn via `npm start`):

1. NGINX-Container → **Konfiguration** (oder Endpoints)
2. Proxy-Ziel: Node.js-Container, Port = Wert der Umgebungsvariable `PORT`
   (oft **3000** oder **8080** – im Node.js-Container unter Variablen
   nachsehen)
3. Bei **502 Bad Gateway**: Logs des Node.js-Containers prüfen (`npm run build`
   erfolgreich? `npm start` läuft?). Per SSH/Web-SSH testen:
   `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/`

#### Schritt 5 – whatwatt Go + HiveMQ (falls noch nicht eingerichtet)

Parallel zum App-Deploy (Details im whatwatt-Abschnitt oben):

1. HiveMQ Cloud: kostenlosen Cluster + Nutzer anlegen
2. whatwatt Go Web-UI → MQTT aktivieren, Broker-URL/Topic/Template eintragen
3. `WHATWATT_MQTT_*`-Variablen in Jelastic setzen (Schritt 3)

#### Schritt 6 – Tablet & externer Zugriff

- Jelastic-URL im Browser/Kiosk-App auf dem Tablet öffnen
- Dashboard pollt alle 5 s – hält die Umgebung tagsüber aktiv
- **Nachtbetrieb (23:59–06:00, kein Traffic):** Umgebung kann in Jelastic
  **gestoppt** werden, um Cloudlet-Kosten zu sparen. Beim morgendlichen Start
  baut sich die MQTT-Verbindung neu auf; die "heute"-Netzwerte im whatwatt-
  Tile beginnen dann ab dem ersten empfangenen Messwert (siehe Hinweis im
  whatwatt-Abschnitt).

#### Kosten (Richtwert)

- Abrechnung nach **Cloudlets** (sekundengenau); 1 reserviertes Cloudlet ≈
  0,01 €/Stunde
- **4 reservierte Cloudlets** (512 MB), ~18 h/Tag aktiv (06:00–24:00):
  grob **8–12 €/Monat**
- 24/7 mit 4 Cloudlets: grob **15–18 €/Monat**
- Nach der 14-tägigen Testphase: Jelastic-Credits aufladen (Mindestbetrag
  laut Infomaniak-Manager)

#### Alternative Hosting-Anbieter

| Anbieter | Sitz | ca. Kosten | Besonderheit |
|---|---|---|---|
| Clever Cloud (Pico/Nano) | 🇫🇷 | 4,50–6 €/Mo | Git-Deploy, EU |
| Scalingo | 🇫🇷 | ab 7,20 €/Mo | Heroku-ähnlich, EU |
| Deploio (Nine) | 🇨🇭 | ab CHF 8.75/Mo | Schweizer Heroku-Alternative |
| Render Free | 🇺🇸 | 0 € | schläft ein; OK wenn nur tagsüber genutzt |
| Northflank Sandbox | 🇬🇧 | 0 € | always-on, Kreditkarte nötig, nur 256 MB |

### Betrieb direkt auf dem Android-Tablet (Alternative ohne Cloud-Kosten)

Wer lieber ganz ohne Cloud-Hosting/-Kosten auskommen möchte, kann die App
stattdessen weiterhin direkt auf dem Android-Tablet selbst laufen lassen,
das ohnehin als Display dient – das Tablet übernimmt dann beide Rollen
(Server + Anzeige). Die MQTT-Anbindung funktioniert dabei genauso wie beim
Cloud-Hosting (sie braucht nur eine ausgehende Internetverbindung zum
Broker, keine lokale Nähe zum whatwatt Go).

Umsetzung über [Termux](https://termux.dev/) (Linux-Terminal-App für
Android, Installation über [F-Droid](https://f-droid.org/packages/com.termux/),
nicht über den veralteten Play-Store-Eintrag):

```bash
pkg install nodejs git
git clone <dein-repo-url>
cd pv-dash
npm install
# .env.local mit den FusionSolar- und WHATWATT_MQTT_*-Variablen anlegen
npm run build && npm run start
```

Anschließend im Browser auf demselben Tablet `http://localhost:47823`
öffnen – idealerweise über eine Kiosk-Browser-App (z. B. "Fully Kiosk
Browser"), die im Vollbild ohne Adressleiste fest auf diese Adresse zeigt
und den Bildschirm dauerhaft an lässt. Für externen Zugriff von unterwegs
bräuchte diese Variante zusätzlich einen Tunnel-Dienst (z. B. Cloudflare
Tunnel), da das Tablet sonst nur im Heimnetz erreichbar ist.

Damit das dauerhaft im Hintergrund läuft:

- **Akku-Optimierung für Termux deaktivieren** (Android-Einstellungen → Apps
  → Termux → Akku → "Nicht optimieren"), sonst beendet Android den Prozess
  im Hintergrund.
- **Termux:Boot** (separate App, ebenfalls über F-Droid) einrichten, damit
  `npm run start` automatisch nach einem Neustart (z. B. nach
  Stromausfall) wieder anläuft.
- `termux-wake-lock` im Start-Skript verwenden, damit die CPU nicht in den
  Schlafmodus geht, während der Bildschirm läuft.

## Projektstruktur

```
src/
  app/
    layout.tsx        Root-Layout, Metadata, Viewport, Theme-Provider
    page.tsx           Einstiegspunkt, rendert das Dashboard
    manifest.ts         PWA-Manifest (installierbar auf Android/iOS)
    api/pv/route.ts      Server-Endpunkt: FusionSolar oder Simulation, je nach Konfiguration
    api/backlog/route.ts Ideen-Backlog (GET/POST/PATCH/DELETE)
  components/
    pv/                 Dashboard-spezifische Komponenten
      dashboard.tsx      Hauptkomponente, verbindet Store + UI
      header.tsx         Kopfzeile mit Live-Status, Quellen-Badge, Backlog, Einstellungen & Theme-Toggle
      backlog-dialog.tsx   Ideen-Backlog (einkippen, erledigen, löschen)
      settings-dialog.tsx  Einstellungen-Dialog (Standort, Stromkonto, Benachrichtigungen)
      kpi-grid.tsx        Kennzahlen-Kacheln (Erzeugung, Verbrauch, ...)
      energy-flow.tsx     Visualisierung des Energieflusses
      metrics-card.tsx    Eigenverbrauch/Autarkie mit Fortschrittsbalken
      sun-times-card.tsx   Sonnenauf-/-untergang & prognostizierte Sonnenstunden
      charts-section.tsx   Verlaufs-Diagramme (Heute/Woche/Monat/Lebensdauer)
    ui/                 shadcn/ui Basis-Komponenten
  lib/
    pv-data.ts          Simulation der PV-Daten (Fallback)
    pv-source.ts         Wählt FusionSolar oder Simulation, serverseitig
    pv-store.ts          Client-Store, pollt /api/pv (5 s Takt)
    sun.ts               Sonnenauf-/-untergang & Sonnenstunden-Prognose (suncalc)
    backlog.ts           Serverseitiges Backlog (.data/backlog.json)
    backlog-store.ts     Client-Store für das Ideen-Backlog
    site-location.ts     Standort (Standard Bätterkinden, Einstellungen/localStorage)
    notifications.ts      Push-Benachrichtigung bei Ertrags-Schwellenwert (Browser-Notification-API)
    fusionsolar/
      config.ts           Liest Zugangsdaten aus Umgebungsvariablen
      client.ts            HTTP-Client: Login/Session, Northbound-Endpunkte
      mapper.ts             Wandelt FusionSolar-Rohdaten in App-Datentypen um
      service.ts            Caching-Schicht (Ratenlimit-bewusst)
      types.ts               Typen der FusionSolar-Rohantworten
    whatwatt/
      config.ts           Liest MQTT-Broker-Zugangsdaten/-Topic aus Umgebungsvariablen
      mapper.ts             Leitet Tageswerte aus kumulierten Zählerständen ab
      service.ts              Dauerhafte MQTT-Abo-Verbindung + In-Memory-Zwischenspeicher
      types.ts                 Typ der erwarteten MQTT-Nachricht (Payload-Template)
scripts/
  jelastic-postdeploy.sh   Post-Deploy-Hook für Infomaniak Jelastic Cloud (npm install + build)
```

## Responsives & plattformübergreifendes Design

- Layout reagiert per Tailwind-Breakpoints und `landscape:`-Varianten auf
  Fenstergröße **und** Ausrichtung (Hoch-/Querformat).
- `viewport-fit=cover` + Safe-Area-Paddings für Geräte mit Notch/Home-Indicator
  (iPhone).
- Web-App-Manifest mit Icon, Theme-Farbe und `display: standalone` für die
  Installation auf dem Homescreen (Android & iOS).
- Hell-/Dunkelmodus folgt automatisch dem Systemthema, ist aber jederzeit per
  Klick umschaltbar.
