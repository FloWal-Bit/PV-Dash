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

type PersistedState = {
  configuredBalanceKwh: number;
  baseline: MeterBaseline | null;
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

function isMeterBaseline(value: unknown): value is MeterBaseline {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isFinite(Number(v.importBaseline)) &&
    Number.isFinite(Number(v.exportBaseline)) &&
    typeof v.establishedAt === "string"
  );
}

function loadState(): PersistedState {
  try {
    if (!existsSync(DATA_FILE)) {
      return { configuredBalanceKwh: defaultConfiguredBalance(), baseline: null };
    }

    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return { configuredBalanceKwh: defaultConfiguredBalance(), baseline: null };
    }

    const v = parsed as Record<string, unknown>;

    // Neues Format: { configuredBalanceKwh, baseline }
    if ("configuredBalanceKwh" in v) {
      const configuredBalanceKwh = Number(v.configuredBalanceKwh);
      const baseline = isMeterBaseline(v.baseline) ? v.baseline : null;
      return {
        configuredBalanceKwh: Number.isFinite(configuredBalanceKwh)
          ? configuredBalanceKwh
          : defaultConfiguredBalance(),
        baseline,
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
      };
    }
  } catch {
    // fall through
  }

  return { configuredBalanceKwh: defaultConfiguredBalance(), baseline: null };
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
  const state: PersistedState = {
    configuredBalanceKwh: round(balanceKwh),
    baseline: meterTotals
      ? {
          importBaseline: meterTotals.energyInKwh,
          exportBaseline: meterTotals.energyOutKwh,
          establishedAt: new Date().toISOString(),
        }
      : null,
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

  const changeTodayKwh = gridFeedInTodayKwh - gridImportTodayKwh;

  return {
    balanceKwh: round(state.configuredBalanceKwh + netDeltaKwh),
    changeTodayKwh: round(changeTodayKwh),
  };
}

/**
 * Stellt sicher, dass der Snapshot immer einen Stromkonto-Stand zeigt:
 * - whatwatt: präzise Berechnung (Basis ± kumulierte Netzänderung seit Anheftung)
 * - sonst: Basis ± heutige Netzbilanz, falls Netzdaten vorhanden
 * - sonst: nur der konfigurierte Basiskontostand
 */
export function applyStromkontoToSnapshot(
  snapshot: PvSnapshot,
  options: { fromWhatWatt: boolean },
): PvSnapshot {
  if (options.fromWhatWatt && snapshot.stromkontoBalanceKwh != null) {
    return snapshot;
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
