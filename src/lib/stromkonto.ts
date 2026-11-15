/**
 * Stromkonto: konfigurierbarer Basiskontostand plus laufende Netto-
 * Veränderung aus whatwatt-Zählerständen (Einspeisung minus Bezug).
 *
 * Der Basiskontostand ist in den Einstellungen oder per STROMKONTO_BALANCE_KWH
 * setzbar (Standard 516 kWh). Zähler-Referenzwerte werden in
 * .data/stromkonto.json persistiert.
 *
 * Nachtpause (Node 23:30–06:00): Ohne Mitternachts-Messwert schätzen wir den
 * Tagesbeginn aus dem letzten bekannten Zählerstand und dem ersten Morgenwert
 * (lineare Interpolation auf Europe/Zurich-Mitternacht). Sonst würde
 * dayBaseline erst ~06:00 gesetzt und „Stromkonto heute“ die Nacht verlieren.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { PvSnapshot } from "@/lib/pv-data";
import {
  DEFAULT_STROMKONTO_BALANCE_KWH,
  parseStromkontoBalanceInput,
} from "@/lib/stromkonto-shared";

export { DEFAULT_STROMKONTO_BALANCE_KWH, parseStromkontoBalanceInput };

type MeterBaseline = {
  importBaseline: number;
  exportBaseline: number;
  establishedAt: string;
};

type TodayEntry = {
  /** Lokaler Kalendertag, für den der Tageswert gilt. */
  day: string;
  /** Eingegebener Netto-Tageswert in kWh (positiv = eingezahlt). */
  changeKwh: number;
  /** Zählerstand Bezug zum Speicherzeitpunkt; null, bis ein Messwert da ist. */
  importKwh: number | null;
  /** Zählerstand Einspeisung zum Speicherzeitpunkt. */
  exportKwh: number | null;
};

type DayMeterBaseline = {
  /** Kalendertag Europe/Zurich, YYYY-MM-DD. */
  day: string;
  /** Zählerstand Bezug zu Beginn dieses Tages. */
  importKwh: number;
  /** Zählerstand Einspeisung zu Beginn dieses Tages. */
  exportKwh: number;
};

type LastMeters = {
  importKwh: number;
  exportKwh: number;
  /** ISO-Zeitpunkt der Messung. */
  at: string;
};

type LastComputed = {
  balanceKwh: number;
  changeTodayKwh: number;
  at: string;
};

type PersistedState = {
  configuredBalanceKwh: number;
  baseline: MeterBaseline | null;
  today: TodayEntry | null;
  dayBaseline: DayMeterBaseline | null;
  /**
   * Letzter gültiger whatwatt-Zählerstand — für Mitternachts-Schätzung nach
   * der Node-Nachtpause und als Schutz vor kurzen MQTT-Ausreißern.
   */
  lastMeters: LastMeters | null;
  /**
   * Zuletzt aus whatwatt berechnetes Stromkonto. Fallback, solange MQTT nach
   * dem Hochfahren noch fehlt (statt fälschlich Basis + FusionSolar-Heute).
   */
  lastComputed: LastComputed | null;
  /**
   * Kalenderjahr der letzten Nacht vom 3. auf den 4. August, in der der
   * Kontostand auf 0 gesetzt wurde. Fehlt der Wert, gilt das laufende
   * Kontojahr als bereits berücksichtigt, damit ein bestehender Stand
   * nicht nachträglich gelöscht wird.
   */
  lastAugustResetYear: number | null;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "stromkonto.json");

/** Kleine Zähler-Jitter-Toleranz (kWh); darunter dayBaseline nachziehen. */
const METER_JITTER_KWH = 0.05;

function readEnvBalance(): number | null {
  const raw = process.env.STROMKONTO_BALANCE_KWH?.trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultConfiguredBalance(): number {
  return readEnvBalance() ?? DEFAULT_STROMKONTO_BALANCE_KWH;
}

/** True, sobald ein Startstand gespeichert oder per Umgebungsvariable gesetzt wurde. */
function hasExplicitBalance(): boolean {
  return existsSync(DATA_FILE) || readEnvBalance() != null;
}

function isMeterBaseline(value: unknown): value is MeterBaseline {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isFinite(Number(v.importBaseline)) &&
    Number.isFinite(Number(v.exportBaseline)) &&
    typeof v.establishedAt === "string"
  );
}

function isTodayEntry(value: unknown): value is TodayEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const importKwh = v.importKwh;
  const exportKwh = v.exportKwh;
  return (
    typeof v.day === "string" &&
    Number.isFinite(Number(v.changeKwh)) &&
    (importKwh == null || Number.isFinite(Number(importKwh))) &&
    (exportKwh == null || Number.isFinite(Number(exportKwh)))
  );
}

function isLastMeters(value: unknown): value is LastMeters {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isFinite(Number(v.importKwh)) &&
    Number.isFinite(Number(v.exportKwh)) &&
    typeof v.at === "string"
  );
}

function isLastComputed(value: unknown): value is LastComputed {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isFinite(Number(v.balanceKwh)) &&
    Number.isFinite(Number(v.changeTodayKwh)) &&
    typeof v.at === "string"
  );
}

function emptyState(): PersistedState {
  return {
    configuredBalanceKwh: defaultConfiguredBalance(),
    baseline: null,
    today: null,
    dayBaseline: null,
    lastMeters: null,
    lastComputed: null,
    lastAugustResetYear: latestAugustResetYear(new Date()),
  };
}

/**
 * Jahr der letzten Nacht vom 3. auf den 4. August, die zu diesem Zeitpunkt
 * schon begonnen hat. Am 4. August um 00:00 Uhr Schweizer Zeit wechselt das Jahr.
 */
export function latestAugustResetYear(date: Date): number {
  const [year, month, day] = appDayKey(date).split("-").map(Number);
  const resetHasStarted = month > 8 || (month === 8 && day >= 4);
  return resetHasStarted ? year : year - 1;
}

/** Kalendertag in Europe/Zurich. Unabhängig von der Zeitzone des Servers. */
export function appDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Mitternacht des genannten Schweizer Kalendertags, als Unix-ms. */
export function zurichMidnightMs(dayKey: string): number {
  const utcMidnight = Date.parse(`${dayKey}T00:00:00Z`);
  const zurichHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(utcMidnight)),
  );
  return utcMidnight - zurichHour * 60 * 60 * 1000;
}

function isDayMeterBaseline(value: unknown): value is DayMeterBaseline {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.day === "string" &&
    Number.isFinite(Number(v.importKwh)) &&
    Number.isFinite(Number(v.exportKwh))
  );
}

function loadState(): PersistedState {
  try {
    if (!existsSync(DATA_FILE)) {
      return emptyState();
    }

    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return emptyState();
    }

    const v = parsed as Record<string, unknown>;

    // Neues Format: { configuredBalanceKwh, baseline }
    if ("configuredBalanceKwh" in v) {
      const configuredBalanceKwh = Number(v.configuredBalanceKwh);
      const baseline = isMeterBaseline(v.baseline) ? v.baseline : null;
      const todayRaw = v.today;
      const today = isTodayEntry(todayRaw)
        ? {
            day: todayRaw.day,
            changeKwh: Number(todayRaw.changeKwh),
            importKwh: todayRaw.importKwh == null ? null : Number(todayRaw.importKwh),
            exportKwh: todayRaw.exportKwh == null ? null : Number(todayRaw.exportKwh),
          }
        : null;
      return rememberResetYear({
        configuredBalanceKwh: Number.isFinite(configuredBalanceKwh)
          ? configuredBalanceKwh
          : defaultConfiguredBalance(),
        baseline,
        today,
        dayBaseline: isDayMeterBaseline(v.dayBaseline)
          ? {
              day: v.dayBaseline.day,
              importKwh: Number(v.dayBaseline.importKwh),
              exportKwh: Number(v.dayBaseline.exportKwh),
            }
          : null,
        lastMeters: isLastMeters(v.lastMeters)
          ? {
              importKwh: Number(v.lastMeters.importKwh),
              exportKwh: Number(v.lastMeters.exportKwh),
              at: v.lastMeters.at,
            }
          : null,
        lastComputed: isLastComputed(v.lastComputed)
          ? {
              balanceKwh: Number(v.lastComputed.balanceKwh),
              changeTodayKwh: Number(v.lastComputed.changeTodayKwh),
              at: v.lastComputed.at,
            }
          : null,
        lastAugustResetYear: resetYearFrom(v.lastAugustResetYear),
      });
    }

    // Altes Format migrieren: { balanceKwh, importBaseline, exportBaseline, … }
    const balanceKwh = Number(v.balanceKwh);
    const importBaseline = Number(v.importBaseline);
    const exportBaseline = Number(v.exportBaseline);
    const establishedAt = typeof v.establishedAt === "string" ? v.establishedAt : "";
    if (
      Number.isFinite(balanceKwh) &&
      Number.isFinite(importBaseline) &&
      Number.isFinite(exportBaseline)
    ) {
      return rememberResetYear({
        configuredBalanceKwh: balanceKwh,
        baseline: { importBaseline, exportBaseline, establishedAt },
        today: null,
        dayBaseline: null,
        lastMeters: null,
        lastComputed: null,
        lastAugustResetYear: null,
      });
    }
  } catch {
    // fall through
  }

  return rememberResetYear(emptyState());
}

function resetYearFrom(value: unknown): number | null {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 3000 ? year : null;
}

/**
 * Ein fehlendes Reset-Jahr wird auf das laufende Kontojahr gesetzt und
 * gespeichert. Der Kontostand bleibt dabei unverändert.
 */
function rememberResetYear(state: PersistedState): PersistedState {
  if (state.lastAugustResetYear != null) return state;
  const stamped: PersistedState = {
    ...state,
    lastAugustResetYear: latestAugustResetYear(new Date()),
  };
  saveState(stamped);
  return stamped;
}

function saveState(state: PersistedState): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Schätzt Zählerstände zur Zurich-Mitternacht, wenn der Node über Mitternacht
 * aus war: linear zwischen letztem Abend- und erstem Morgenwert.
 */
export function estimateMetersAtZurichMidnight(
  last: LastMeters,
  cumulativeImportKwh: number,
  cumulativeExportKwh: number,
  dayKey: string,
  now: Date = new Date(),
): { importKwh: number; exportKwh: number } | null {
  const lastAt = Date.parse(last.at);
  if (!Number.isFinite(lastAt)) return null;

  const midnight = zurichMidnightMs(dayKey);
  const nowMs = now.getTime();
  if (lastAt >= midnight || nowMs <= midnight) return null;

  // Zähler rückwärts → Ausreißer oder Zählerwechsel, keine Interpolation.
  if (
    cumulativeImportKwh + METER_JITTER_KWH < last.importKwh ||
    cumulativeExportKwh + METER_JITTER_KWH < last.exportKwh
  ) {
    return null;
  }

  const span = nowMs - lastAt;
  if (span <= 0) return null;
  const t = Math.min(1, Math.max(0, (midnight - lastAt) / span));

  return {
    importKwh: last.importKwh + (cumulativeImportKwh - last.importKwh) * t,
    exportKwh: last.exportKwh + (cumulativeExportKwh - last.exportKwh) * t,
  };
}

export type StromkontoSnapshot = {
  /** Aktueller Kontostand in kWh (Basiskontostand ± laufende Netto-Veränderung). */
  balanceKwh: number;
  /** Netto-Veränderung heute: Einspeisung minus Bezug (kWh). */
  changeTodayKwh: number;
};

/** Aktuell konfigurierter Basiskontostand in kWh. */
export function getStromkontoBaseBalance(): number {
  return loadState().configuredBalanceKwh;
}

/**
 * Setzt den Basiskontostand. Mit Zählerständen: neue Anheftung.
 * Ohne Zähler, aber mit bekannter Baseline + lastComputed: Baseline behalten
 * und konfigurierten Stand so verschieben, dass der Live-Wert dem Eingabewert
 * entspricht (verhindert versehentliches Nullen der Anheftung bei MQTT-Lücke).
 * Sonst: Anheftung beim nächsten whatwatt-Messwert.
 */
export function setStromkontoBaseBalance(
  balanceKwh: number,
  meterTotals?: { energyInKwh: number; energyOutKwh: number },
): PersistedState {
  const previous = loadState();
  const wanted = round(balanceKwh);

  let baseline: MeterBaseline | null;
  let configuredBalanceKwh = wanted;

  if (meterTotals) {
    baseline = {
      importBaseline: meterTotals.energyInKwh,
      exportBaseline: meterTotals.energyOutKwh,
      establishedAt: new Date().toISOString(),
    };
  } else if (previous.baseline && previous.lastComputed) {
    const netDelta = previous.lastComputed.balanceKwh - previous.configuredBalanceKwh;
    configuredBalanceKwh = round(wanted - netDelta);
    baseline = previous.baseline;
  } else {
    baseline = null;
  }

  const state: PersistedState = {
    configuredBalanceKwh,
    baseline,
    today: previous.today,
    dayBaseline: previous.dayBaseline,
    lastMeters: previous.lastMeters,
    lastComputed: previous.lastComputed,
    lastAugustResetYear: previous.lastAugustResetYear,
  };
  saveState(state);
  return state;
}

/** Gespeicherter Tageswert, wenn er zum heutigen Kalendertag gehört. */
export function getStromkontoTodayChange(): number | null {
  const today = loadState().today;
  if (!today || today.day !== appDayKey(new Date())) return null;
  return today.changeKwh;
}

/**
 * Setzt den Netto-Tageswert (positiv = eingezahlt, negativ = bezogen).
 * Liegt ein Zählerstand vor, werden spätere Messwerte darauf addiert.
 */
export function setStromkontoTodayChange(
  changeKwh: number,
  meterTotals?: { energyInKwh: number; energyOutKwh: number },
): PersistedState {
  const previous = loadState();
  const state: PersistedState = {
    ...previous,
    today: {
      day: appDayKey(new Date()),
      changeKwh: round(changeKwh),
      importKwh: meterTotals?.energyInKwh ?? null,
      exportKwh: meterTotals?.energyOutKwh ?? null,
    },
  };
  saveState(state);
  return state;
}

/**
 * Bezug und Einspeisung seit Mitternacht Europe/Zurich.
 * Der Zählerstand zu Tagesbeginn bleibt in stromkonto.json, damit ein
 * Neustart des Servers den Tageswert nicht auf 0 setzt.
 * Fehlt der Mitternachtswert (Nachtpause), wird er aus lastMeters geschätzt.
 */
export function meterTotalsSinceZurichDayStart(
  cumulativeImportKwh: number,
  cumulativeExportKwh: number,
  now: Date = new Date(),
): { gridImportTodayKwh: number; gridFeedInTodayKwh: number } {
  const key = appDayKey(now);
  const state = loadState();
  let day = state.dayBaseline;

  if (!day || day.day !== key) {
    const estimated =
      state.lastMeters != null
        ? estimateMetersAtZurichMidnight(
            state.lastMeters,
            cumulativeImportKwh,
            cumulativeExportKwh,
            key,
            now,
          )
        : null;
    day = {
      day: key,
      importKwh: estimated?.importKwh ?? cumulativeImportKwh,
      exportKwh: estimated?.exportKwh ?? cumulativeExportKwh,
    };
    saveState({ ...state, dayBaseline: day });
  } else if (
    cumulativeImportKwh < day.importKwh - METER_JITTER_KWH ||
    cumulativeExportKwh < day.exportKwh - METER_JITTER_KWH
  ) {
    const looksLikeMeterReset =
      cumulativeImportKwh < 1 &&
      cumulativeExportKwh < 1 &&
      (day.importKwh > 10 || day.exportKwh > 10);
    const smallJitter =
      day.importKwh - cumulativeImportKwh <= METER_JITTER_KWH &&
      day.exportKwh - cumulativeExportKwh <= METER_JITTER_KWH;

    if (looksLikeMeterReset || smallJitter) {
      day = {
        day: key,
        importKwh: Math.min(day.importKwh, cumulativeImportKwh),
        exportKwh: Math.min(day.exportKwh, cumulativeExportKwh),
      };
      saveState({ ...state, dayBaseline: day });
    }
    // Sonst: kurzen MQTT-Ausreißer ignorieren, dayBaseline behalten.
  }

  return {
    gridImportTodayKwh: round(Math.max(0, cumulativeImportKwh - day.importKwh)),
    gridFeedInTodayKwh: round(Math.max(0, cumulativeExportKwh - day.exportKwh)),
  };
}

/**
 * Manueller Tageswert plus Zählerdelta seit dem Speichern.
 * Fehlt die Anheftung noch, wird sie mit dem aktuellen Zählerstand gesetzt.
 */
function resolveManualTodayChange(
  state: PersistedState,
  cumulativeImportKwh: number,
  cumulativeExportKwh: number,
  now: Date,
): { changeTodayKwh: number; state: PersistedState } | null {
  const today = state.today;
  if (!today || today.day !== appDayKey(now)) return null;

  if (today.importKwh == null || today.exportKwh == null) {
    const anchored: PersistedState = {
      ...state,
      today: {
        ...today,
        importKwh: cumulativeImportKwh,
        exportKwh: cumulativeExportKwh,
      },
    };
    saveState(anchored);
    return { changeTodayKwh: round(today.changeKwh), state: anchored };
  }

  const deltaExport = cumulativeExportKwh - today.exportKwh;
  const deltaImport = cumulativeImportKwh - today.importKwh;
  return {
    changeTodayKwh: round(today.changeKwh + deltaExport - deltaImport),
    state,
  };
}

/**
 * Berechnet Stromkonto aus kumulierten Zählerständen und Tagesdeltas.
 * Ein manuell gesetzter Tageswert (Dev-Settings) überschreibt die reine
 * Mitternachts-Differenz und läuft danach mit dem Zähler weiter.
 */
export function computeStromkonto(
  cumulativeImportKwh: number,
  cumulativeExportKwh: number,
  gridImportTodayKwh: number,
  gridFeedInTodayKwh: number,
  now: Date = new Date(),
): StromkontoSnapshot {
  let state = loadState();
  const dueYear = latestAugustResetYear(now);
  if (state.lastAugustResetYear != null && state.lastAugustResetYear < dueYear) {
    state = {
      ...state,
      configuredBalanceKwh: 0,
      baseline: {
        importBaseline: cumulativeImportKwh,
        exportBaseline: cumulativeExportKwh,
        establishedAt: now.toISOString(),
      },
      lastAugustResetYear: dueYear,
    };
    saveState(state);
  }

  let baseline = state.baseline;

  if (!baseline) {
    baseline = {
      importBaseline: cumulativeImportKwh,
      exportBaseline: cumulativeExportKwh,
      establishedAt: now.toISOString(),
    };
  }

  const netDeltaKwh =
    cumulativeExportKwh -
    baseline.exportBaseline -
    (cumulativeImportKwh - baseline.importBaseline);

  const manualToday = resolveManualTodayChange(
    state,
    cumulativeImportKwh,
    cumulativeExportKwh,
    now,
  );
  const changeTodayKwh =
    manualToday?.changeTodayKwh ?? round(gridFeedInTodayKwh - gridImportTodayKwh);
  const balanceKwh = round(state.configuredBalanceKwh + netDeltaKwh);
  const at = now.toISOString();

  saveState({
    ...(manualToday?.state ?? state),
    baseline,
    lastMeters: {
      importKwh: cumulativeImportKwh,
      exportKwh: cumulativeExportKwh,
      at,
    },
    lastComputed: {
      balanceKwh,
      changeTodayKwh,
      at,
    },
  });

  return {
    balanceKwh,
    changeTodayKwh,
  };
}

/**
 * Stromkonto nur aus gemessenen Netzdaten:
 * - whatwatt: Basis ± kumulierte Netzänderung seit Anheftung
 * - ohne whatwatt: zuletzt berechneter Stand (überlebt MQTT-Lücke nach Nachtpause);
 *   nicht mehr „Basis + FusionSolar-Heute“ (verfälscht den Absolutstand über Tage)
 * - Simulation: gespeicherter Startstand, aber keine erfundene Tagesänderung.
 *   Ohne gespeicherten Startstand bleiben beide Werte leer.
 */
export function applyStromkontoToSnapshot(
  snapshot: PvSnapshot,
  options: { fromWhatWatt: boolean; fromSimulation: boolean },
): PvSnapshot {
  if (options.fromWhatWatt && snapshot.stromkontoBalanceKwh != null) {
    return snapshot;
  }

  if (options.fromSimulation) {
    return {
      ...snapshot,
      stromkontoBalanceKwh: hasExplicitBalance() ? getStromkontoBaseBalance() : null,
      stromkontoChangeTodayKwh: null,
    };
  }

  const state = loadState();
  if (state.lastComputed) {
    const computedDay = appDayKey(new Date(state.lastComputed.at));
    const todayKey = appDayKey(new Date());
    const manualToday = getStromkontoTodayChange();
    return {
      ...snapshot,
      stromkontoBalanceKwh: state.lastComputed.balanceKwh,
      stromkontoChangeTodayKwh:
        manualToday ??
        (computedDay === todayKey ? state.lastComputed.changeTodayKwh : null),
    };
  }

  const base = getStromkontoBaseBalance();
  const manualToday = getStromkontoTodayChange();

  return {
    ...snapshot,
    stromkontoBalanceKwh: base,
    stromkontoChangeTodayKwh: manualToday,
  };
}
