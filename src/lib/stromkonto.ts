/**
 * Stromkonto: konfigurierbarer Basiskontostand plus laufende Netto-
 * Veränderung aus whatwatt-Zählerständen (Einspeisung minus Bezug).
 *
 * Der Basiskontostand ist in den Einstellungen oder per STROMKONTO_BALANCE_KWH
 * setzbar (Standard 516 kWh). Zähler-Referenzwerte werden in
 * .data/stromkonto.json persistiert.
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

type PersistedState = {
  configuredBalanceKwh: number;
  baseline: MeterBaseline | null;
  today: TodayEntry | null;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "stromkonto.json");

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

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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

function emptyState(): PersistedState {
  return { configuredBalanceKwh: defaultConfiguredBalance(), baseline: null, today: null };
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
      return {
        configuredBalanceKwh: Number.isFinite(configuredBalanceKwh)
          ? configuredBalanceKwh
          : defaultConfiguredBalance(),
        baseline,
        today,
      };
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
      return {
        configuredBalanceKwh: balanceKwh,
        baseline: { importBaseline, exportBaseline, establishedAt },
        today: null,
      };
    }
  } catch {
    // fall through
  }

  return emptyState();
}

function saveState(state: PersistedState): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
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
 * Setzt den Basiskontostand. Optional werden aktuelle Zählerstände sofort
 * als neue Referenz gespeichert; sonst erfolgt die Anheftung beim nächsten
 * whatwatt-Messwert.
 */
export function setStromkontoBaseBalance(
  balanceKwh: number,
  meterTotals?: { energyInKwh: number; energyOutKwh: number },
): PersistedState {
  const previous = loadState();
  const state: PersistedState = {
    configuredBalanceKwh: round(balanceKwh),
    baseline: meterTotals
      ? {
          importBaseline: meterTotals.energyInKwh,
          exportBaseline: meterTotals.energyOutKwh,
          establishedAt: new Date().toISOString(),
        }
      : null,
    today: previous.today,
  };
  saveState(state);
  return state;
}

/** Gespeicherter Tageswert, wenn er zum heutigen Kalendertag gehört. */
export function getStromkontoTodayChange(): number | null {
  const today = loadState().today;
  if (!today || today.day !== localDayKey(new Date())) return null;
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
      day: localDayKey(new Date()),
      changeKwh: round(changeKwh),
      importKwh: meterTotals?.energyInKwh ?? null,
      exportKwh: meterTotals?.energyOutKwh ?? null,
    },
  };
  saveState(state);
  return state;
}

/**
 * Berechnet Stromkonto aus kumulierten Zählerständen und Tagesdeltas.
 */
export function computeStromkonto(
  cumulativeImportKwh: number,
  cumulativeExportKwh: number,
  gridImportTodayKwh: number,
  gridFeedInTodayKwh: number,
  now: Date = new Date(),
): StromkontoSnapshot {
  const state = loadState();
  let baseline = state.baseline;

  if (!baseline) {
    baseline = {
      importBaseline: cumulativeImportKwh,
      exportBaseline: cumulativeExportKwh,
      establishedAt: now.toISOString(),
    };
    saveState({ ...state, baseline });
  }

  const netDeltaKwh =
    cumulativeExportKwh -
    baseline.exportBaseline -
    (cumulativeImportKwh - baseline.importBaseline);

  const changeTodayKwh = resolveChangeToday(
    state,
    cumulativeImportKwh,
    cumulativeExportKwh,
    gridFeedInTodayKwh - gridImportTodayKwh,
    now,
  );

  return {
    balanceKwh: round(state.configuredBalanceKwh + netDeltaKwh),
    changeTodayKwh,
  };
}

function resolveChangeToday(
  state: PersistedState,
  cumulativeImportKwh: number,
  cumulativeExportKwh: number,
  measuredTodayKwh: number,
  now: Date,
): number {
  const today = state.today;
  if (!today || today.day !== localDayKey(now)) {
    return round(measuredTodayKwh);
  }

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
    return round(today.changeKwh);
  }

  const sinceEntryKwh =
    cumulativeExportKwh -
    today.exportKwh -
    (cumulativeImportKwh - today.importKwh);
  return round(today.changeKwh + sinceEntryKwh);
}

/**
 * Stromkonto nur aus gemessenen Netzdaten:
 * - whatwatt: Basis ± kumulierte Netzänderung seit Anheftung
 * - FusionSolar: Basis ± heutige Netzbilanz, falls die Anlage sie meldet
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

  const base = getStromkontoBaseBalance();
  const changeToday =
    snapshot.gridFeedInTodayKwh != null
      ? round(snapshot.gridFeedInTodayKwh - (snapshot.gridImportTodayKwh ?? 0))
      : null;

  if (changeToday != null) {
    return {
      ...snapshot,
      stromkontoBalanceKwh: round(base + changeToday),
      stromkontoChangeTodayKwh: changeToday,
    };
  }

  return {
    ...snapshot,
    stromkontoBalanceKwh: base,
    stromkontoChangeTodayKwh: null,
  };
}
