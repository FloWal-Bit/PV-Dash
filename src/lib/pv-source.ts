/**
 * Serverseitiger Einstiegspunkt für Dashboard-Daten. Nutzt FusionSolar, wenn
 * konfiguriert und erreichbar, und fällt sonst (oder bei Fehlern) auf die
 * lokale Simulation zurück – die App bleibt so immer benutzbar, auch ohne
 * Zugangsdaten oder bei einer vorübergehend nicht erreichbaren Anlage.
 */

import {
  getLifetimeHistory,
  getMonthHistory,
  getSnapshot,
  getTodayHistory,
  getWeekHistory,
  getYearHistory,
  type DailyEnergyPoint,
  type HistoryPoint,
  type PvSnapshot,
} from "@/lib/pv-data";
import { isFusionSolarConfigured } from "@/lib/fusionsolar/config";
import {
  getFusionSolarHistory,
  getFusionSolarLifetimeHistory,
  getFusionSolarLiveSnapshot,
} from "@/lib/fusionsolar/service";
import { applyStromkontoToSnapshot, computeStromkonto } from "@/lib/stromkonto";
import { isWhatWattConfigured } from "@/lib/whatwatt/config";
import { resolveOpenMeteoPeakKwp } from "@/lib/open-meteo-yield/config";
import {
  getOpenMeteoTodayAndTomorrowYieldKwh,
  type OpenMeteoYieldMeta,
} from "@/lib/open-meteo-yield/service";
import { getLatestWhatWattMeterTotals, getWhatWattGridSnapshot } from "@/lib/whatwatt/service";

export type PvHistory = {
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
  lifetime: DailyEnergyPoint[];
};

export type DataSource = "fusionsolar" | "simulation";

/** Woher die Netzbezug/-einspeisung-Werte im Snapshot stammen. */
export type GridSource = "whatwatt" | null;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Verbrauch aus Erzeugung + Netzleistung (positiv = Bezug, negativ = Einspeisung). */
function consumptionFromEnergyBalance(productionKw: number, gridKw: number): number {
  return round(Math.max(0, productionKw + gridKw));
}

function consumptionMetrics(productionKw: number, consumptionKw: number) {
  const selfConsumptionRate =
    productionKw > 0.05
      ? Math.min(100, Math.round((Math.min(productionKw, consumptionKw) / productionKw) * 100))
      : 0;
  const autarkyRate =
    consumptionKw > 0.05
      ? Math.min(100, Math.round((Math.min(productionKw, consumptionKw) / consumptionKw) * 100))
      : 0;
  return { selfConsumptionRate, autarkyRate };
}

export type LiveDashboardPayload = {
  source: DataSource;
  /** Ist ein whatwatt Go konfiguriert und erreichbar, überschreibt es die Netzwerte der Hauptquelle. */
  gridSource: GridSource;
  snapshot: PvSnapshot;
  /** Prognostizierter Tagesertrag (kWh), Open-Meteo GTI × kWp × PR für heute. */
  forecastedTodayYieldKwh: number | null;
  /** Gesetzt, wenn die Ertragsprognose (Open-Meteo) nicht erreichbar ist. */
  forecastSolarError: string | null;
  /** Zur Verifikation: GTI-Summe, PR, Ideal-kWh (nur Open-Meteo). */
  forecastYieldMeta: OpenMeteoYieldMeta | null;
  forecastedTomorrowYieldKwh: number | null;
  forecastTomorrowYieldMeta: OpenMeteoYieldMeta | null;
  /** Nutzerfreundliche Meldung, z. B. wenn FusionSolar konfiguriert, aber gerade nicht erreichbar ist. */
  warning: string | null;
};

export type HistoryPayload = PvHistory & {
  source: DataSource;
};

function simulateHistory(now = new Date()): PvHistory {
  return {
    today: getTodayHistory(now),
    week: getWeekHistory(now),
    month: getMonthHistory(now),
    year: getYearHistory(now),
    lifetime: getLifetimeHistory(now),
  };
}

/**
 * Überschreibt Netzbezug/-einspeisung im Snapshot mit den Live-Messwerten
 * eines lokalen whatwatt Go, falls konfiguriert und erreichbar. whatwatt Go
 * misst direkt am Netzanschluss (Smart-Meter-Adapter) und liefert damit
 * meist genauere Netzwerte als die PV-Anlage selbst – ist es nicht
 * konfiguriert oder gerade nicht erreichbar, bleiben die Netzwerte der
 * Hauptquelle (FusionSolar/Simulation) unverändert.
 */
async function overlayWhatWattGrid(
  snapshot: PvSnapshot,
): Promise<{ snapshot: PvSnapshot; gridSource: GridSource; warning: string | null }> {
  if (!isWhatWattConfigured()) {
    return { snapshot, gridSource: null, warning: null };
  }

  try {
    const grid = await getWhatWattGridSnapshot();
    const consumptionKw = consumptionFromEnergyBalance(snapshot.productionKw, grid.gridKw);
    const { selfConsumptionRate, autarkyRate } = consumptionMetrics(
      snapshot.productionKw,
      consumptionKw,
    );
    return {
      snapshot: {
        ...snapshot,
        gridKw: grid.gridKw,
        consumptionKw,
        selfConsumptionRate,
        autarkyRate,
        gridImportTodayKwh: grid.gridImportTodayKwh,
        gridFeedInTodayKwh: grid.gridFeedInTodayKwh,
        stromkontoBalanceKwh: grid.stromkontoBalanceKwh,
        stromkontoChangeTodayKwh: grid.stromkontoChangeTodayKwh,
      },
      gridSource: "whatwatt",
      warning: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    console.error("[whatwatt] Netzmesswerte nicht verfügbar, zeige Netzwerte der Hauptquelle:", message);
    return {
      snapshot,
      gridSource: null,
      warning: `whatwatt Go nicht erreichbar (${message}). Zeige Netzwerte der Hauptquelle.`,
    };
  }
}

/** Momentanwerte für Energiefluss, Kennzahlen und Prognose. Ohne Verlaufsreihen. */
export async function getLiveDashboardPayload(): Promise<LiveDashboardPayload> {
  const base = await (async (): Promise<{ source: DataSource; snapshot: PvSnapshot; warning: string | null }> => {
    if (!isFusionSolarConfigured()) {
      return { source: "simulation", snapshot: getSnapshot(new Date()), warning: null };
    }

    try {
      const snapshot = await getFusionSolarLiveSnapshot();
      return { source: "fusionsolar", snapshot, warning: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      console.error("[fusionsolar] Live-Abruf fehlgeschlagen, zeige Simulation:", message);
      return {
        source: "simulation",
        snapshot: getSnapshot(new Date()),
        warning: `FusionSolar nicht erreichbar (${message}). Zeige simulierte Daten.`,
      };
    }
  })();

  const overlay = await overlayWhatWattGrid(base.snapshot);
  let snapshot = applyStromkontoToSnapshot(overlay.snapshot, {
    fromWhatWatt: overlay.gridSource === "whatwatt",
    fromSimulation: base.source === "simulation",
  });
  if (overlay.gridSource === "whatwatt") {
    const meters = getLatestWhatWattMeterTotals();
    if (meters) {
      const stromkonto = computeStromkonto(
        meters.energyInKwh,
        meters.energyOutKwh,
        snapshot.gridImportTodayKwh ?? 0,
        snapshot.gridFeedInTodayKwh ?? 0,
      );
      snapshot = {
        ...snapshot,
        stromkontoBalanceKwh: stromkonto.balanceKwh,
        stromkontoChangeTodayKwh: stromkonto.changeTodayKwh,
      };
    }
  }

  const yieldForecast = await getOpenMeteoTodayAndTomorrowYieldKwh(
    resolveOpenMeteoPeakKwp(),
    new Date(snapshot.timestamp),
  );

  return {
    source: base.source,
    gridSource: overlay.gridSource,
    snapshot,
    forecastedTodayYieldKwh: yieldForecast.today.kwh,
    forecastSolarError: yieldForecast.today.error ?? yieldForecast.error,
    forecastYieldMeta: yieldForecast.today.meta,
    forecastedTomorrowYieldKwh: yieldForecast.tomorrow.kwh,
    forecastTomorrowYieldMeta: yieldForecast.tomorrow.meta,
    warning: base.warning ?? overlay.warning,
  };
}

/** Verlaufsreihen für die Diagramme. Unabhängig vom 15-Sekunden-Live-Abruf. */
export async function getHistoryPayload(): Promise<HistoryPayload> {
  if (!isFusionSolarConfigured()) {
    return { source: "simulation", ...simulateHistory() };
  }

  const [history, lifetime] = await Promise.all([
    getFusionSolarHistory(),
    getFusionSolarLifetimeHistory(),
  ]);
  return { source: "fusionsolar", ...history, lifetime };
}
