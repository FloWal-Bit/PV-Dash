"use client";

import type { PvSnapshot } from "@/lib/pv-data";
import { APP_TIME_ZONE, lastDailyCheckpointMs, msUntilNextDailyCheckpoint } from "@/lib/daily-checkpoint";
import { addZurichDaysKey, isScheduledServerPause } from "@/lib/server-pause-window";
import { DEFAULT_SITE_LOCATION, type SiteLocation } from "@/lib/site-location";
import { WETTER_ALARM_UNAVAILABLE } from "@/lib/service-unavailable-messages";

export type WeatherPayload = {
  weatherLabel: string;
  weatherCategory: PvSnapshot["weather"];
  sunrise: string;
  sunset: string;
  sunriseAt: string;
  sunsetAt: string;
  sunHours: number;
  /** Tagesminimum und Tagesmaximum in °C. Fehlt in älteren Caches. */
  temperatureMin?: number | null;
  temperatureMax?: number | null;
  locationName: string;
  date: string;
  source: "wetteralarm";
};

type WeatherState = {
  byDate: Record<string, WeatherPayload>;
  data: WeatherPayload | null;
  error: string | null;
  loading: boolean;
  locationKey: string;
  lastFetchAt: number | null;
};

const PERSIST_KEY = "pv-dash:weather-cache";

const SERVER_STATE: WeatherState = {
  byDate: {},
  data: null,
  error: null,
  loading: false,
  locationKey: DEFAULT_SITE_LOCATION.name,
  lastFetchAt: null,
};

type PersistedWeatherCache = {
  locationKey: string;
  lastFetchAt: number;
  byDate: Record<string, WeatherPayload>;
};

type Listener = () => void;
const listeners = new Set<Listener>();
let state: WeatherState = SERVER_STATE;
let inflight: Promise<void> | null = null;
/** Letzter Versuch, Temperaturen nachzuladen. Verhindert ein Dauer-Polling, wenn der Server sie noch nicht liefert. */
let lastTemperatureGapFetchAt = 0;
let dailyTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let dayWatchTimer: ReturnType<typeof globalThis.setInterval> | null = null;
let visibilityBound = false;
let hydrated = false;
let activeLocation: Pick<SiteLocation, "name" | "latitude" | "longitude"> = DEFAULT_SITE_LOCATION;

function locationKey(location: Pick<SiteLocation, "name" | "latitude" | "longitude">): string {
  const name = location.name.trim() || DEFAULT_SITE_LOCATION.name;
  return `${name}|${location.latitude}|${location.longitude}|temperature`;
}

function emit() {
  for (const listener of listeners) listener();
}

export function weatherDateKey(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

function tomorrowDateKey(from = new Date()): string {
  return addZurichDaysKey(weatherDateKey(from), 1);
}

function dayAfterTomorrowDateKey(from = new Date()): string {
  return addZurichDaysKey(weatherDateKey(from), 2);
}

function readPersistedCache(): PersistedWeatherCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null) return null;
    const v = parsed as PersistedWeatherCache;
    if (typeof v.locationKey !== "string" || typeof v.lastFetchAt !== "number") {
      return null;
    }
    if (typeof v.byDate !== "object" || v.byDate == null) return null;
    return v;
  } catch {
    return null;
  }
}

function writePersistedCache(cache: PersistedWeatherCache): void {
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(cache));
  } catch {
    // Speicher voll o. ä. — weiter ohne Persistenz.
  }
}

function hydrateFromPersistence() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const persisted = readPersistedCache();
  if (!persisted) return;

  const todayKey = weatherDateKey();
  state = {
    ...state,
    locationKey: persisted.locationKey,
    lastFetchAt: persisted.lastFetchAt,
    byDate: persisted.byDate,
    data: persisted.byDate[todayKey] ?? null,
  };
}

function hasTemperature(payload: WeatherPayload | null | undefined): boolean {
  return (
    typeof payload?.temperatureMin === "number" &&
    Number.isFinite(payload.temperatureMin) &&
    typeof payload.temperatureMax === "number" &&
    Number.isFinite(payload.temperatureMax)
  );
}

/** Cache aus der Zeit vor den Temperaturfeldern: Sonnenzeiten sind da, °C fehlen. */
function cachedTemperatureGap(): boolean {
  for (const key of [weatherDateKey(), tomorrowDateKey(), dayAfterTomorrowDateKey()]) {
    const day = state.byDate[key] ?? null;
    if (day != null && !hasTemperature(day)) return true;
  }
  return false;
}

function needsNetworkFetch(locationKey: string, force: boolean): boolean {
  if (force) return true;
  if (state.locationKey !== locationKey) return true;
  if (cachedTemperatureGap() && Date.now() - lastTemperatureGapFetchAt > 10 * 60 * 1000) {
    return true;
  }

  const todayKey = weatherDateKey();
  const tomorrowKey = tomorrowDateKey();
  const dayAfterKey = dayAfterTomorrowDateKey();
  const hasToday = state.byDate[todayKey] != null;
  const hasTomorrow = state.byDate[tomorrowKey] != null;
  const hasDayAfter = state.byDate[dayAfterKey] != null;
  if (!hasToday) return true;
  // Nachts ist der Node aus. Heute liegt meist schon als gestrige „Morgen“-Prognose im Cache.
  // Die Folgetage können bis zur 06:00-Marke warten, sonst scheitert der Abruf und setzt einen Fehler.
  if ((!hasTomorrow || !hasDayAfter) && !isScheduledServerPause()) return true;

  if (state.lastFetchAt == null) return true;
  return state.lastFetchAt < lastDailyCheckpointMs();
}

async function fetchWeatherDay(
  location: Pick<SiteLocation, "name" | "latitude" | "longitude">,
  dateKey: string,
): Promise<WeatherPayload> {
  const params = new URLSearchParams({
    location: location.name.trim() || DEFAULT_SITE_LOCATION.name,
    date: dateKey,
    latitude: String(location.latitude),
    longitude: String(location.longitude),
  });
  const res = await fetch(`/api/weather?${params}`, { cache: "no-store" });
  const body: unknown = await res.json();
  if (!res.ok) {
    throw new Error(WETTER_ALARM_UNAVAILABLE);
  }
  return body as WeatherPayload;
}

async function fetchForecastDays(
  location: Pick<SiteLocation, "name" | "latitude" | "longitude">,
): Promise<void> {
  const todayKey = weatherDateKey();
  const results = await Promise.allSettled([
    fetchWeatherDay(location, todayKey),
    fetchWeatherDay(location, tomorrowDateKey()),
    fetchWeatherDay(location, dayAfterTomorrowDateKey()),
  ]);

  const byDate = { ...state.byDate };
  let anyOk = false;
  for (const result of results) {
    if (result.status === "fulfilled") {
      byDate[result.value.date] = result.value;
      anyOk = true;
    }
  }

  const lastFetchAt = anyOk ? Date.now() : state.lastFetchAt;
  state = {
    ...state,
    byDate,
    data: byDate[todayKey] ?? state.data,
    error: anyOk ? null : WETTER_ALARM_UNAVAILABLE,
    loading: false,
    lastFetchAt,
  };

  if (anyOk && lastFetchAt != null) {
    writePersistedCache({
      locationKey: locationKey(location),
      lastFetchAt,
      byDate,
    });
  }
}

function realignTodayPointer() {
  const todayKey = weatherDateKey();
  const today = state.byDate[todayKey] ?? null;
  if (state.data === today) return;
  state = { ...state, data: today };
  emit();
}

function scheduleDailyRefresh() {
  if (typeof window === "undefined") return;
  if (dailyTimer != null) globalThis.clearTimeout(dailyTimer);
  dailyTimer = globalThis.setTimeout(() => {
    void weatherStore.refresh(activeLocation, { force: true });
    scheduleDailyRefresh();
  }, msUntilNextDailyCheckpoint());
}

function onAppVisible() {
  if (typeof document !== "undefined" && document.hidden) return;
  realignTodayPointer();
  void weatherStore.refresh(activeLocation);
}

function ensureScheduler() {
  hydrateFromPersistence();
  realignTodayPointer();
  scheduleDailyRefresh();
  if (typeof window === "undefined") return;
  if (!visibilityBound) {
    document.addEventListener("visibilitychange", onAppVisible);
    window.addEventListener("pageshow", onAppVisible);
    visibilityBound = true;
  }
  if (dayWatchTimer == null) {
    dayWatchTimer = globalThis.setInterval(() => {
      const todayKey = weatherDateKey();
      const today = state.byDate[todayKey] ?? null;
      if (state.data !== today) realignTodayPointer();
      const tomorrowMissing =
        state.byDate[tomorrowDateKey()] == null ||
        state.byDate[dayAfterTomorrowDateKey()] == null;
      const checkpointDue =
        state.lastFetchAt == null || state.lastFetchAt < lastDailyCheckpointMs();
      if (
        !today ||
        checkpointDue ||
        cachedTemperatureGap() ||
        (tomorrowMissing && !isScheduledServerPause())
      ) {
        void weatherStore.refresh(activeLocation);
      }
    }, 30_000);
  }
}

export const weatherStore = {
  subscribe(listener: Listener): () => void {
    ensureScheduler();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): WeatherState {
    return state;
  },
  getServerSnapshot(): WeatherState {
    return SERVER_STATE;
  },
  getWeatherForDate(dateKey: string): WeatherPayload | null {
    return state.byDate[dateKey] ?? null;
  },
  async refresh(
    location: Pick<SiteLocation, "name" | "latitude" | "longitude">,
    options?: { force?: boolean },
  ): Promise<void> {
    activeLocation = location;
    const key = locationKey(location);
    const force = options?.force === true;

    if (inflight && state.locationKey === key && !force) {
      return inflight;
    }

    hydrateFromPersistence();

    if (!needsNetworkFetch(key, force)) {
      state = { ...state, locationKey: key, loading: false };
      emit();
      return;
    }

    if (cachedTemperatureGap()) lastTemperatureGapFetchAt = Date.now();

    const todayKey = weatherDateKey();
    const hasToday = state.byDate[todayKey] != null && state.locationKey === key;
    state = {
      ...state,
      locationKey: key,
      loading: !hasToday,
      error: null,
    };
    emit();

    inflight = fetchForecastDays(location)
      .catch(() => {
        state = {
          ...state,
          error: WETTER_ALARM_UNAVAILABLE,
          loading: false,
        };
      })
      .finally(() => {
        inflight = null;
        emit();
      });

    return inflight;
  },
};
