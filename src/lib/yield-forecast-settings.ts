/**
 * Anlagenwerte für die Ertragsprognose.
 * Stundenweise Einstrahlung (GTI) × kWp / 1000 × Leistungsfaktor.
 */

import {
  DEFAULT_OPEN_METEO_PERFORMANCE_RATIO,
  OPEN_METEO_AZIMUTH_DEG,
  OPEN_METEO_LATITUDE,
  OPEN_METEO_LONGITUDE,
  OPEN_METEO_TILT_DEG,
  resolveOpenMeteoPerformanceRatio,
} from "@/lib/open-meteo-yield/config";
import { resolveForecastSolarPeakKwp } from "@/lib/forecast-solar/config";

export type YieldForecastPlant = {
  latitude: number;
  longitude: number;
  tiltDeg: number;
  azimuthDeg: number;
  peakKwp: number;
  performanceRatio: number;
};

const STORAGE_KEY = "pv-dash:yield-forecast";

export function defaultYieldForecastPlant(): YieldForecastPlant {
  return {
    latitude: OPEN_METEO_LATITUDE,
    longitude: OPEN_METEO_LONGITUDE,
    tiltDeg: OPEN_METEO_TILT_DEG,
    azimuthDeg: OPEN_METEO_AZIMUTH_DEG,
    peakKwp: resolveForecastSolarPeakKwp(),
    performanceRatio: resolveOpenMeteoPerformanceRatio(),
  };
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function normalizeYieldForecastPlant(
  value: Partial<YieldForecastPlant> | null | undefined,
  fallback: YieldForecastPlant = defaultYieldForecastPlant(),
): YieldForecastPlant {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  const tiltDeg = Number(value?.tiltDeg);
  const azimuthDeg = Number(value?.azimuthDeg);
  const peakKwp = Number(value?.peakKwp);
  const performanceRatio = Number(value?.performanceRatio);
  return {
    latitude: inRange(latitude, -90, 90) ? latitude : fallback.latitude,
    longitude: inRange(longitude, -180, 180) ? longitude : fallback.longitude,
    tiltDeg: inRange(tiltDeg, 0, 90) ? tiltDeg : fallback.tiltDeg,
    azimuthDeg: inRange(azimuthDeg, -180, 180) ? azimuthDeg : fallback.azimuthDeg,
    peakKwp: Number.isFinite(peakKwp) && peakKwp > 0 && peakKwp <= 1000 ? peakKwp : fallback.peakKwp,
    performanceRatio:
      Number.isFinite(performanceRatio) && performanceRatio > 0 && performanceRatio <= 1.2
        ? performanceRatio
        : fallback.performanceRatio,
  };
}

export function readYieldForecastPlant(): YieldForecastPlant {
  const fallback = defaultYieldForecastPlant();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return normalizeYieldForecastPlant(JSON.parse(raw) as Partial<YieldForecastPlant>, fallback);
  } catch {
    return fallback;
  }
}

export function parseYieldForecastInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let state: YieldForecastPlant = {
  latitude: OPEN_METEO_LATITUDE,
  longitude: OPEN_METEO_LONGITUDE,
  tiltDeg: OPEN_METEO_TILT_DEG,
  azimuthDeg: OPEN_METEO_AZIMUTH_DEG,
  peakKwp: 30.34,
  performanceRatio: DEFAULT_OPEN_METEO_PERFORMANCE_RATIO,
};

function emit() {
  for (const listener of listeners) listener();
}

export const yieldForecastStore = {
  subscribe(listener: Listener): () => void {
    state = readYieldForecastPlant();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): YieldForecastPlant {
    return state;
  },
  getServerSnapshot(): YieldForecastPlant {
    return {
      latitude: OPEN_METEO_LATITUDE,
      longitude: OPEN_METEO_LONGITUDE,
      tiltDeg: OPEN_METEO_TILT_DEG,
      azimuthDeg: OPEN_METEO_AZIMUTH_DEG,
      peakKwp: 30.34,
      performanceRatio: DEFAULT_OPEN_METEO_PERFORMANCE_RATIO,
    };
  },
  save(plant: YieldForecastPlant): Promise<void> {
    const normalized = normalizeYieldForecastPlant(plant);
    return import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
      putDevSettings({ yieldForecast: normalized }).then(() => undefined),
    );
  },
  applyRemote(plant: YieldForecastPlant): void {
    const normalized = normalizeYieldForecastPlant(plant);
    state = normalized;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
    emit();
  },
};
