/**
 * Letzter erfolgreicher Live-/History-Stand im localStorage —
 * für Anzeige während Infomaniak-Pause / Netzausfall.
 */

import type { DataSource, GridSource, PvHistory } from "@/lib/pv-source";
import type { PvSnapshot } from "@/lib/pv-data";

const CACHE_KEY = "pv-dash:offline-dashboard-v1";

export type OfflineDashboardCache = {
  savedAt: number;
  live: {
    source: DataSource;
    gridSource: GridSource;
    snapshot: PvSnapshot;
    forecastedTodayYieldKwh: number | null;
    forecastedTomorrowYieldKwh: number | null;
    forecastSolarError: string | null;
    warning: string | null;
    sourceWarning: string | null;
    gridWarning: string | null;
  };
  history: (PvHistory & { source: DataSource }) | null;
};

export function readOfflineDashboardCache(): OfflineDashboardCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as OfflineDashboardCache;
    if (!v.live?.snapshot || !Number.isFinite(v.savedAt)) return null;
    return v;
  } catch {
    return null;
  }
}

export function writeOfflineDashboardCache(cache: OfflineDashboardCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* Quota / private mode */
  }
}
