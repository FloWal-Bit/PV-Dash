"use client";

import type { PvSnapshot } from "@/lib/pv-data";
import { DEFAULT_SITE_LOCATION } from "@/lib/site-location";
import { WETTER_ALARM_UNAVAILABLE } from "@/lib/service-unavailable-messages";

export type WeatherPayload = {
  weatherLabel: string;
  weatherCategory: PvSnapshot["weather"];
  sunrise: string;
  sunset: string;
  sunHours: number;
  locationName: string;
  date: string;
  source: "wetteralarm";
};

type WeatherState = {
  data: WeatherPayload | null;
  error: string | null;
  loading: boolean;
  locationKey: string;
};

const SERVER_STATE: WeatherState = {
  data: null,
  error: null,
  loading: false,
  locationKey: DEFAULT_SITE_LOCATION.name,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let state = SERVER_STATE;
let inflight: Promise<void> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

async function fetchWeather(locationName: string): Promise<void> {
  const params = new URLSearchParams({ location: locationName });
  const res = await fetch(`/api/weather?${params}`, { cache: "no-store" });
  const body: unknown = await res.json();
  if (!res.ok) {
    throw new Error(WETTER_ALARM_UNAVAILABLE);
  }
  state = {
    ...state,
    data: body as WeatherPayload,
    error: null,
    loading: false,
  };
}

function ensurePolling() {
  if (pollTimer != null || typeof window === "undefined") return;
  pollTimer = setInterval(() => {
    void weatherStore.refresh(state.locationKey);
  }, 30 * 60 * 1000);
}

export const weatherStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    ensurePolling();
    return () => listeners.delete(listener);
  },
  getSnapshot(): WeatherState {
    return state;
  },
  getServerSnapshot(): WeatherState {
    return SERVER_STATE;
  },
  async refresh(locationName: string): Promise<void> {
    const key = locationName.trim() || DEFAULT_SITE_LOCATION.name;
    if (inflight && state.locationKey === key) {
      return inflight;
    }

    state = { ...state, locationKey: key, loading: state.data == null, error: null };
    emit();

    inflight = fetchWeather(key)
      .catch((error: unknown) => {
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
