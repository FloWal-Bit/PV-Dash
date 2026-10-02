import type { DashboardData, DataSource, GridSource } from "@/lib/pv-source";

export type PvStoreState = {
  data: DashboardData | null;
  error: string | null;
  source: DataSource | null;
  gridSource: GridSource;
  forecastedTodayYieldKwh: number | null;
  warning: string | null;
  /** Client-Zeitpunkt des letzten erfolgreichen API-Abrufs (für „Aktualisiert“). */
  lastFetchedAt: number | null;
};

const REFRESH_INTERVAL_MS = 5000;
const INITIAL_STATE: PvStoreState = {
  data: null,
  error: null,
  source: null,
  gridSource: null,
  forecastedTodayYieldKwh: null,
  warning: null,
  lastFetchedAt: null,
};

type Listener = () => void;

/**
 * Externer Store für die PV-Live-Daten. Pollt `/api/pv` (das serverseitig
 * FusionSolar oder die Simulation bedient) und läuft über
 * `useSyncExternalStore`, damit der erste Client-Render exakt dem
 * Server-Snapshot entspricht (kein Hydration-Mismatch) und Aktualisierungen
 * danach als Store-Update statt als Effekt-`setState` ablaufen.
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
        warning: string | null;
      };
      this.state = {
        data: payload.data,
        error: null,
        source: payload.source,
        gridSource: payload.gridSource,
        forecastedTodayYieldKwh: payload.forecastedTodayYieldKwh ?? null,
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
    // Snapshot the listener set: a listener could unsubscribe (e.g. via
    // Strict Mode's mount/unmount/mount dance) while we're iterating.
    for (const listener of [...this.listeners]) listener();
  };

  private ensureRunning() {
    if (this.intervalId) return;
    void this.tick();
    this.intervalId = setInterval(this.tick, REFRESH_INTERVAL_MS);
  }

  /**
   * IMPORTANT: the listener must be registered *before* `ensureRunning()`
   * kicks off its first `tick()`. `tick()` is async, but the listener set it
   * reads when it eventually notifies is captured at call time, not at
   * subscribe time — as long as `add()` below runs synchronously before any
   * `await` inside that first `tick()` resolves, the new listener is already
   * in the set when notification happens. Getting the order backwards is
   * exactly what caused the original hydration bug: an empty listener set at
   * notify-time means React never learns the store changed, and the UI gets
   * stuck on the initial (null) snapshot forever.
   */
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
