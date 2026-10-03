/**
 * Tagesertrags-Prognose: Summe stündlicher GTI (Wh/m²) × kWp / 1000 × PR.
 * @see https://open-meteo.com/en/docs
 */

import {
  OPEN_METEO_AZIMUTH_DEG,
  OPEN_METEO_LATITUDE,
  OPEN_METEO_LONGITUDE,
  OPEN_METEO_TILT_DEG,
  OPEN_METEO_TIMEZONE,
  resolveOpenMeteoPerformanceRatio,
} from "@/lib/open-meteo-yield/config";
import { todayDateKeyInZurich } from "@/lib/forecast-solar/service";
import { OPEN_METEO_YIELD_UNAVAILABLE } from "@/lib/service-unavailable-messages";

export type OpenMeteoYieldMeta = {
  source: "open-meteo";
  dateKey: string;
  gtiWhPerM2: number;
  idealKwh: number;
  performanceRatio: number;
  peakKwp: number;
};

export type OpenMeteoYieldResult = {
  kwh: number | null;
  error: string | null;
  meta: OpenMeteoYieldMeta | null;
};

const API_BASE = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 45 * 60 * 1000;

type HourlyGti = { times: string[]; gti: (number | null)[] };

type CacheEntry = {
  expiresAt: number;
  hourly: HourlyGti;
  peakKwp: number;
  performanceRatio: number;
  refDateKey: string;
};

let cache: CacheEntry | null = null;
let cacheKey = "";

export function dateKeyInZurich(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: OPEN_METEO_TIMEZONE });
}

export function dateKeyPlusDaysInZurich(date: Date, days: number): string {
  const shifted = new Date(date.getTime() + days * 86_400_000);
  return dateKeyInZurich(shifted);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

type OpenMeteoForecastResponse = {
  hourly?: {
    time?: string[];
    global_tilted_irradiance?: (number | null)[];
  };
};

function sumGtiWhPerM2ForDay(
  times: string[],
  gti: (number | null)[],
  dateKey: string,
): number {
  let sum = 0;
  for (let i = 0; i < times.length; i++) {
    if (!times[i]?.startsWith(dateKey)) continue;
    const v = gti[i];
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}

function buildForecastUrl(): string {
  const params = new URLSearchParams({
    latitude: String(OPEN_METEO_LATITUDE),
    longitude: String(OPEN_METEO_LONGITUDE),
    hourly: "global_tilted_irradiance",
    tilt: String(OPEN_METEO_TILT_DEG),
    azimuth: String(OPEN_METEO_AZIMUTH_DEG),
    timezone: OPEN_METEO_TIMEZONE,
  });
  return `${API_BASE}?${params.toString()}`;
}

function logVerification(meta: OpenMeteoYieldMeta, kwh: number): void {
  console.info(
    "[open-meteo-yield] verify",
    JSON.stringify({
      dateKey: meta.dateKey,
      gtiWhPerM2: Math.round(meta.gtiWhPerM2),
      idealKwh: meta.idealKwh,
      performanceRatio: meta.performanceRatio,
      peakKwp: meta.peakKwp,
      forecastKwh: kwh,
    }),
  );
}

function yieldFromHourly(
  hourly: HourlyGti,
  dateKey: string,
  peakKwp: number,
  performanceRatio: number,
): OpenMeteoYieldResult {
  const gtiWhPerM2 = sumGtiWhPerM2ForDay(hourly.times, hourly.gti, dateKey);
  if (!Number.isFinite(gtiWhPerM2) || gtiWhPerM2 <= 0) {
    return { kwh: null, error: OPEN_METEO_YIELD_UNAVAILABLE, meta: null };
  }

  const idealKwh = round1((gtiWhPerM2 * peakKwp) / 1000);
  const kwh = round1(idealKwh * performanceRatio);
  const meta: OpenMeteoYieldMeta = {
    source: "open-meteo",
    dateKey,
    gtiWhPerM2: round1(gtiWhPerM2),
    idealKwh,
    performanceRatio,
    peakKwp,
  };
  return { kwh, error: null, meta };
}

async function loadForecastHourly(): Promise<HourlyGti | null> {
  const url = buildForecastUrl();
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    console.error("[open-meteo-yield] HTTP", res.status, url);
    return null;
  }
  const body = (await res.json()) as OpenMeteoForecastResponse;
  const times = body.hourly?.time;
  const gti = body.hourly?.global_tilted_irradiance;
  if (!times?.length || !gti?.length) {
    console.error("[open-meteo-yield] missing hourly GTI");
    return null;
  }
  return { times, gti };
}

export type OpenMeteoDayForecasts = {
  today: OpenMeteoYieldResult;
  tomorrow: OpenMeteoYieldResult;
  error: string | null;
};

export async function getOpenMeteoTodayAndTomorrowYieldKwh(
  peakKwp: number,
  date = new Date(),
): Promise<OpenMeteoDayForecasts> {
  const empty: OpenMeteoDayForecasts = {
    today: { kwh: null, error: null, meta: null },
    tomorrow: { kwh: null, error: null, meta: null },
    error: null,
  };
  if (!Number.isFinite(peakKwp) || peakKwp <= 0) {
    return empty;
  }

  const todayKey = todayDateKeyInZurich(date);
  const tomorrowKey = dateKeyPlusDaysInZurich(date, 1);
  const performanceRatio = resolveOpenMeteoPerformanceRatio();
  const key = `${todayKey}:${peakKwp}:${performanceRatio}`;

  let hourly: HourlyGti | null = null;
  if (cache && cacheKey === key && cache.expiresAt > Date.now()) {
    hourly = cache.hourly;
  } else {
    try {
      hourly = await loadForecastHourly();
      if (!hourly) {
        return {
          ...empty,
          error: OPEN_METEO_YIELD_UNAVAILABLE,
        };
      }
      cache = {
        hourly,
        peakKwp,
        performanceRatio,
        refDateKey: todayKey,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      cacheKey = key;
    } catch (err) {
      console.error("[open-meteo-yield] fetch failed:", err);
      return { ...empty, error: OPEN_METEO_YIELD_UNAVAILABLE };
    }
  }

  const today = yieldFromHourly(hourly, todayKey, peakKwp, performanceRatio);
  const tomorrow = yieldFromHourly(hourly, tomorrowKey, peakKwp, performanceRatio);
  if (today.meta) logVerification(today.meta, today.kwh ?? 0);
  if (tomorrow.meta) logVerification(tomorrow.meta, tomorrow.kwh ?? 0);

  const error =
    today.error && tomorrow.error ? OPEN_METEO_YIELD_UNAVAILABLE : null;

  return { today, tomorrow, error };
}

export async function getOpenMeteoForecastedTodayYieldKwh(
  peakKwp: number,
  date = new Date(),
): Promise<OpenMeteoYieldResult> {
  const { today, error } = await getOpenMeteoTodayAndTomorrowYieldKwh(peakKwp, date);
  if (today.kwh == null && error) {
    return { kwh: null, error, meta: null };
  }
  return today;
}
