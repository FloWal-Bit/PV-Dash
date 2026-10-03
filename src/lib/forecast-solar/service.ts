/**
 * Tagesertrags-Prognose via forecast.solar (Stundenwerte summiert).
 * @see https://api.forecast.solar/
 */

import {
  FORECAST_SOLAR_AZIMUTH_DEG,
  FORECAST_SOLAR_DECLINATION_DEG,
  FORECAST_SOLAR_LATITUDE,
  FORECAST_SOLAR_LONGITUDE,
} from "@/lib/forecast-solar/config";
import { FORECAST_SOLAR_UNAVAILABLE } from "@/lib/service-unavailable-messages";

export type ForecastSolarResult = {
  kwh: number | null;
  error: string | null;
};

const API_BASE = "https://api.forecast.solar/estimate";
const CACHE_TTL_MS = 45 * 60 * 1000; // API: 12 req/h/IP — nicht öfter pollen

type CacheEntry = { expiresAt: number; kwh: number };
let cache: CacheEntry | null = null;
let cacheKey = "";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatCoord(value: number): string {
  return value.toFixed(2);
}

function formatPeakKwp(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Kalendertag in Europe/Zurich (API-Zeitzone für Bätterkinden). */
export function todayDateKeyInZurich(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

type ForecastSolarResponse = {
  result?: {
    watt_hours_period?: Record<string, number>;
    watt_hours_day?: Record<string, number>;
  };
};

function sumHourlyWhForDay(
  wattHoursPeriod: Record<string, number>,
  dateKey: string,
): number {
  let sum = 0;
  for (const [timestamp, wh] of Object.entries(wattHoursPeriod)) {
    if (!timestamp.startsWith(dateKey)) continue;
    if (Number.isFinite(wh)) sum += wh;
  }
  return sum;
}

function buildEstimateUrl(latitude: number, longitude: number, peakKwp: number): string {
  return `${API_BASE}/${formatCoord(latitude)}/${formatCoord(longitude)}/${FORECAST_SOLAR_DECLINATION_DEG}/${FORECAST_SOLAR_AZIMUTH_DEG}/${formatPeakKwp(peakKwp)}`;
}

/**
 * Prognostizierter Tagesertrag (kWh) = Summe der `watt_hours_period`-Werte
 * für den angegebenen Tag (Wh → kWh).
 */
export async function getForecastedTodayYieldKwh(
  peakKwp: number,
  date = new Date(),
): Promise<ForecastSolarResult> {
  if (!Number.isFinite(peakKwp) || peakKwp <= 0) {
    return { kwh: null, error: null };
  }

  const latitude = FORECAST_SOLAR_LATITUDE;
  const longitude = FORECAST_SOLAR_LONGITUDE;
  const dateKey = todayDateKeyInZurich(date);
  const key = `${formatCoord(latitude)}:${formatCoord(longitude)}:${peakKwp}:${dateKey}`;

  if (cache && cacheKey === key && cache.expiresAt > Date.now()) {
    return { kwh: cache.kwh, error: null };
  }

  const url = buildEstimateUrl(latitude, longitude, peakKwp);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      console.error("[forecast.solar] HTTP", res.status, url);
      return { kwh: null, error: FORECAST_SOLAR_UNAVAILABLE };
    }

    const body = (await res.json()) as ForecastSolarResponse;
    const period = body.result?.watt_hours_period;
    if (!period || typeof period !== "object") {
      console.error("[forecast.solar] missing watt_hours_period");
      return { kwh: null, error: FORECAST_SOLAR_UNAVAILABLE };
    }

    let wh = sumHourlyWhForDay(period, dateKey);

    if (wh <= 0 && body.result?.watt_hours_day?.[dateKey] != null) {
      wh = Number(body.result.watt_hours_day[dateKey]);
    }

    if (!Number.isFinite(wh) || wh <= 0) {
      return { kwh: null, error: FORECAST_SOLAR_UNAVAILABLE };
    }

    const kwh = round1(wh / 1000);
    cache = { kwh, expiresAt: Date.now() + CACHE_TTL_MS };
    cacheKey = key;
    return { kwh, error: null };
  } catch (err) {
    console.error("[forecast.solar] fetch failed:", err);
    return { kwh: null, error: FORECAST_SOLAR_UNAVAILABLE };
  }
}
