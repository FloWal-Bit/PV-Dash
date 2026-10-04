/**
 * Tageswetter von Wetter-Alarm (wie auf wetteralarm.ch/wetter-schweiz).
 * @see https://my.wetteralarm.ch/v9/pois/{id}.json
 */

import {
  weatherCategoryFromLabel,
  weatherLabelFromSymbol,
} from "@/lib/wetteralarm/labels";
import type {
  WetterAlarmDailyWeather,
  WetterAlarmPoiResponse,
  WetterAlarmSearchResponse,
} from "@/lib/wetteralarm/types";
import { DEFAULT_SITE_LOCATION } from "@/lib/site-location";

const SEARCH_URL = "https://my.wetteralarm.ch/web/search.json";
const POI_URL = "https://my.wetteralarm.ch/v9/pois";
/** Tagesprognose ändert sich selten — langer Cache spart Wetter-Alarm-Traffic. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type PoiCacheEntry = { expiresAt: number; poiId: number };
type ForecastCacheEntry = { expiresAt: number; data: WetterAlarmDailyWeather };

const poiIdCache = new Map<string, PoiCacheEntry>();
const forecastCache = new Map<string, ForecastCacheEntry>();

function normalizeLocationQuery(name: string): string {
  return name.trim().toLowerCase();
}

function dateKeyInTimeZone(timeZone: string, date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

function formatTimeInZone(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "–";
  return parsed.toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PV-Dash/1.0" },
    next: { revalidate: 0 },
  });
  if (!response.ok) {
    throw new Error(`Wetter-Alarm HTTP ${response.status} für ${url}`);
  }
  return (await response.json()) as T;
}

function resolvePoiIdFromEnv(): number | null {
  const raw = process.env.WETTERALARM_POI_ID?.trim();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function resolveWetterAlarmPoiId(locationName: string): Promise<number> {
  const fromEnv = resolvePoiIdFromEnv();
  if (fromEnv != null) return fromEnv;

  const key = normalizeLocationQuery(locationName);
  const cached = poiIdCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.poiId;
  }

  const params = new URLSearchParams({
    query: locationName.trim(),
    limit_to: "PointOfInterest",
  });
  const data = await fetchJson<WetterAlarmSearchResponse>(`${SEARCH_URL}?${params}`);
  const hit =
    data.results?.find(
      (r) =>
        r.entity_type === "PointOfInterest" &&
        normalizeLocationQuery(r.de?.label ?? "") === key,
    ) ?? data.results?.[0];

  if (!hit?.entity_id) {
    throw new Error(`Wetter-Alarm: Ort «${locationName}» nicht gefunden`);
  }

  poiIdCache.set(key, { poiId: hit.entity_id, expiresAt: Date.now() + CACHE_TTL_MS });
  return hit.entity_id;
}

export async function getWetterAlarmDailyWeather(options?: {
  locationName?: string;
  date?: Date;
}): Promise<WetterAlarmDailyWeather> {
  const locationName = options?.locationName?.trim() || DEFAULT_SITE_LOCATION.name;
  const poiId = await resolveWetterAlarmPoiId(locationName);
  const date = options?.date ?? new Date();

  const cacheKey = `${poiId}:${dateKeyInTimeZone("Europe/Zurich", date)}`;
  const cached = forecastCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const poi = await fetchJson<WetterAlarmPoiResponse>(`${POI_URL}/${poiId}.json`);
  const timeZone = poi.time_zone || "Europe/Zurich";
  const dateKey = dateKeyInTimeZone(timeZone, date);
  const day =
    poi.day_forecasts?.find((d) => d.date === dateKey) ?? poi.day_forecasts?.[0];

  if (!day) {
    throw new Error(`Wetter-Alarm: Keine Tagesprognose für ${dateKey}`);
  }

  const weatherLabel = weatherLabelFromSymbol(day.symbol, day.symbol_v2);
  const payload: WetterAlarmDailyWeather = {
    poiId,
    locationName: poi.de?.label ?? locationName,
    date: day.date,
    weatherLabel,
    sunrise: formatTimeInZone(day.sunrise, timeZone),
    sunset: formatTimeInZone(day.sunset, timeZone),
    sunriseAt: day.sunrise,
    sunsetAt: day.sunset,
    sunHours: round1(day.insolation ?? 0),
    source: "wetteralarm",
  };

  forecastCache.set(cacheKey, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS });
  return payload;
}

export { weatherCategoryFromLabel };
