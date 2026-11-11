/**
 * Abruf-Budget (Europe/Zurich) — Quelle für Dev Settings und DEPLOY.md.
 * Bei Intervall-/Limit-Änderungen hier und in DEPLOY.md mitziehen.
 */

export type FetchBudgetRow = {
  source: string;
  interval: string;
  fixedTimes: string;
  perDay: string;
  display: string;
};

export const FETCH_BUDGET_INTRO =
  "Node typisch 23:30–06:00 aus. ≈/Tag bei dauerhaft laufendem Node und offenem Dashboard; Pause verkürzt die Nachtwerte.";

export const FETCH_BUDGET_ROWS: FetchBudgetRow[] = [
  {
    source: "Browser → /api/pv",
    interval: "15 s; in Pause ~20 min Probe",
    fixedTimes: "Pause 23:30–06:00",
    perDay: "tagsüber hoch, nachts ~20 Probes",
    display: "treibt Live (Card 1–3, KPIs, Header)",
  },
  {
    source: "Browser → /api/pv/history",
    interval: "15 min; in Pause aus",
    fixedTimes: "—",
    perDay: "~68 (ohne Pause-Nacht)",
    display: "Card 3 alle Tabs",
  },
  {
    source: "FusionSolar Login",
    interval: "25 min",
    fixedTimes: "nein",
    perDay: "~40 (ohne Pause)",
    display: "nicht sichtbar",
  },
  {
    source: "FusionSolar Live RealKpi",
    interval: "6 min Cache",
    fixedTimes: "nein",
    perDay: "~175 Zyklen (ohne Pause)",
    display: "Card 2, Header, KPI Ertrag",
  },
  {
    source: "FusionSolar Heute getDevFiveMinutes",
    interval: "45 min (06–23), 3 h (23–06)",
    fixedTimes: "Fenster 06/23",
    perDay: "~23 + Catch-up; nachts oft 0 wenn Node aus (Limit 25)",
    display: "Card 3 → Heute",
  },
  {
    source: "FusionSolar Zähler 5‑Min",
    interval: "1×/Tag",
    fixedTimes: "erster Bedarf",
    perDay: "1",
    display: "Card 3 → Heute Verbrauchslücken",
  },
  {
    source: "FusionSolar Woche/Monat / Year",
    interval: "12 h; Catch-up einmal nach Start",
    fixedTimes: "~06:00 Warmup",
    perDay: "~2 + Catch-up",
    display: "Card 3 Woche–Laufzeit",
  },
  {
    source: "whatwatt MQTT",
    interval: "Push",
    fixedTimes: "nein",
    perDay: "0 Polls",
    display: "Card 2, KPIs Stromkonto/Verbrauch",
  },
  {
    source: "Open-Meteo",
    interval: "45 min; Catch-up nach Start",
    fixedTimes: "—",
    perDay: "~32",
    display: "Card 1 Prognose",
  },
  {
    source: "Wetter-Alarm",
    interval: "Marken + Catch-up",
    fixedTimes: "06 / 12 / 18 / 23 (+ Warmup ~06:00)",
    perDay: "4 Marken + Start",
    display: "Card 1 Wetter/Sonne",
  },
  {
    source: "Nachtpause Node",
    interval: "aus",
    fixedTimes: "23:30–06:00",
    perDay: "—",
    display: "Banner; keine FusionSolar-Aufrufe wenn Node aus",
  },
  {
    source: "Startup-Catch-up",
    interval: "1× / Prozess",
    fixedTimes: "nach Hochfahren (~06:00)",
    perDay: "1 Sequenz (FusionSolar→OM→WA)",
    display: "Caches Card 1–3",
  },
  {
    source: "Schlaf-Snapshot (Client)",
    interval: "1× / Abend",
    fixedTimes: "~23:27 (3 min vor Pause)",
    perDay: "1× Live+History",
    display: "Offline-Cache für die Nacht",
  },
];
