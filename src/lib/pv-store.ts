import type { DashboardData, DataSource, GridSource } from "@/lib/pv-source";

export type PvStoreState = {
  data: DashboardData | null;
  error: string | null;
  source: DataSource | null;
  gridSource: GridSource;
  forecastedTodayYieldKwh: number | null;
  forecastedTomorrowYieldKwh: number | null;
  forecastSolarError: string | null;
  warning: string | null;
  /** Client-Zeitpunkt des letzten erfolgreichen API-Abrufs (für „Aktualisiert“). */
  lastFetchedAt: number | null;
};

const REFRESH_INTERVAL_MS = 10_000;
const INITIAL_STATE: PvStoreState = {
  data: null,
  error: null,
  source: null,
  gridSource: null,
  forecastedTodayYieldKwh: null,
  forecastedTomorrowYieldKwh: null,
  forecastSolarError: null,
  warning: null,
  lastFetchedAt: null,
};

type Listener = () => void;

/**
 * Pollt `/api/pv` alle 10 Sekunden (tagsüber und nachts), damit Verbrauch,
 * Netz und Stromkonto live bleiben. Serverseitiges FusionSolar-Caching
 * begrenzt externe API-Last.
 */
class PvStore {
  private listeners = new Set<Listener>();
  private state: PvStoreState = INITIAL_STATE;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private tick = async () => {
    try {
      const res = await fetch("/api/pv", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as {
        source: DataSource;
        gridSource: GridSource;
        data: DashboardData;
        forecastedTodayYieldKwh: number | null;
        forecastedTomorrowYieldKwh: number | null;
        forecastSolarError: string | null;
        warning: string | null;
      };
      this.state = {
        data: payload.data,
        error: null,
        source: payload.source,
        gridSource: payload.gridSource,
        forecastedTodayYieldKwh: payload.forecastedTodayYieldKwh ?? null,
        forecastedTomorrowYieldKwh: payload.forecastedTomorrowYieldKwh ?? null,
        forecastSolarError: payload.forecastSolarError ?? null,
        warning: payload.warning,
        lastFetchedAt: Date.now(),
      };
    } catch {
      this.state = {
        ...this.state,
        error:
          "Live-Daten konnten nicht aktualisiert werden. Letzter bekannter Stand wird angezeigt.",
      };
    }
    for (const listener of [...this.listeners]) listener();
  };

  private ensureRunning() {
    if (this.intervalId) return;
    void this.tick();
    this.intervalId = setInterval(this.tick, REFRESH_INTERVAL_MS);
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    this.ensureRunning();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    };
  };

  getSnapshot = (): PvStoreState => this.state;

  getServerSnapshot = (): PvStoreState => INITIAL_STATE;

  refresh = () => {
    void this.tick();
  };
}

export const pvStore = new PvStore();
