"use client";

import type { PvSnapshot } from "@/lib/pv-data";
import { APP_TIME_ZONE, lastDailyCheckpointMs, msUntilNextDailyCheckpoint } from "@/lib/daily-checkpoint";
import { DEFAULT_SITE_LOCATION } from "@/lib/site-location";
import { WETTER_ALARM_UNAVAILABLE } from "@/lib/service-unavailable-messages";

export type WeatherPayload = {
  weatherLabel: string;
  weatherCategory: PvSnapshot["weather"];
  sunrise: string;
  sunset: string;
  sunriseAt: string;
  sunsetAt: string;
  sunHours: number;
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
let dailyTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

function emit() {
  for (const listener of listeners) listener();
}

export function weatherDateKey(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

function tomorrowDateKey(from = new Date()): string {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  return weatherDateKey(next);
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

function needsNetworkFetch(locationKey: string, force: boolean): boolean {
  if (force) return true;
  if (state.locationKey !== locationKey) return true;

  const todayKey = weatherDateKey();
  const tomorrowKey = tomorrowDateKey();
  if (!state.byDate[todayKey] || !state.byDate[tomorrowKey]) {
    return true;
  }

  if (state.lastFetchAt == null) return true;
  return state.lastFetchAt < lastDailyCheckpointMs();
}

async function fetchWeatherDay(
  locationName: string,
  dateKey: string,
): Promise<WeatherPayload> {
  const params = new URLSearchParams({ location: locationName, date: dateKey });
  const res = await fetch(`/api/weather?${params}`, { cache: "no-store" });
  const body: unknown = await res.json();
  if (!res.ok) {
    throw new Error(WETTER_ALARM_UNAVAILABLE);
  }
  return body as WeatherPayload;
}

async function fetchTodayAndTomorrow(locationName: string): Promise<void> {
  const todayKey = weatherDateKey();
  const tomorrowKey = tomorrowDateKey();
  const results = await Promise.allSettled([
    fetchWeatherDay(locationName, todayKey),
    fetchWeatherDay(locationName, tomorrowKey),
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
      locationKey: locationName,
      lastFetchAt,
      byDate,
    });
  }
}

function scheduleDailyRefresh() {
  if (typeof window === "undefined") return;
  if (dailyTimer != null) window.clearTimeout(dailyTimer);
  dailyTimer = window.setTimeout(() => {
    void weatherStore.refresh(state.locationKey, { force: true });
    scheduleDailyRefresh();
  }, msUntilNextDailyCheckpoint());
}

function ensureScheduler() {
  hydrateFromPersistence();
  scheduleDailyRefresh();
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
  async refresh(locationName: string, options?: { force?: boolean }): Promise<void> {
    const key = locationName.trim() || DEFAULT_SITE_LOCATION.name;
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

    const todayKey = weatherDateKey();
    const hasToday = state.byDate[todayKey] != null && state.locationKey === key;
    state = {
      ...state,
      locationKey: key,
      loading: !hasToday,
      error: null,
    };
    emit();

    inflight = fetchTodayAndTomorrow(key)
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
