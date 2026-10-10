import type { DataSource, GridSource, PvHistory } from "@/lib/pv-source";
import type { PvSnapshot } from "@/lib/pv-data";

export type PvStoreState = {
  snapshot: PvSnapshot | null;
  error: string | null;
  source: DataSource | null;
  gridSource: GridSource;
  forecastedTodayYieldKwh: number | null;
  forecastedTomorrowYieldKwh: number | null;
  forecastSolarError: string | null;
  warning: string | null;
  /** Client-Zeitpunkt des letzten erfolgreichen Live-Abrufs (für „Aktualisiert“). */
  lastFetchedAt: number | null;
  history: PvHistory | null;
  historySource: DataSource | null;
  historyError: string | null;
};

const LIVE_INTERVAL_MS = 15_000;
const HISTORY_INTERVAL_MS = 5 * 60 * 1000;
/** Beim Wechsel des Diagramm-Zeitraums neu laden, wenn der Stand älter ist. */
const HISTORY_RANGE_MIN_AGE_MS = 60_000;

const INITIAL_STATE: PvStoreState = {
  snapshot: null,
  error: null,
  source: null,
  gridSource: null,
  forecastedTodayYieldKwh: null,
  forecastedTomorrowYieldKwh: null,
  forecastSolarError: null,
  warning: null,
  lastFetchedAt: null,
  history: null,
  historySource: null,
  historyError: null,
};

type Listener = () => void;

type LiveResponse = {
  source: DataSource;
  gridSource: GridSource;
  snapshot: PvSnapshot;
  forecastedTodayYieldKwh: number | null;
  forecastedTomorrowYieldKwh: number | null;
  forecastSolarError: string | null;
  warning: string | null;
};

type HistoryResponse = PvHistory & { source: DataSource };

/**
 * Live-Zahlen alle 15 Sekunden, Verläufe alle 5 Minuten. Beides pausiert,
 * solange der Tab im Hintergrund ist. whatwatt liefert etwa alle 15 Sekunden
 * einen neuen Zählerstand; häufiger abfragen bringt keinen neueren Wert.
 */
class PvStore {
  private listeners = new Set<Listener>();
  private state: PvStoreState = INITIAL_STATE;
  private liveIntervalId: ReturnType<typeof setInterval> | null = null;
  private historyIntervalId: ReturnType<typeof setInterval> | null = null;
  private visibilityBound = false;
  private liveInflight: Promise<void> | null = null;
  private historyInflight: Promise<void> | null = null;
  private lastHistoryAt: number | null = null;

  private emit() {
    for (const listener of [...this.listeners]) listener();
  }

  private tickLive = async () => {
    if (this.liveInflight) return this.liveInflight;
    this.liveInflight = (async () => {
      try {
        const res = await fetch("/api/pv", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as LiveResponse;
        this.state = {
          ...this.state,
          snapshot: payload.snapshot,
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
      this.emit();
    })().finally(() => {
      this.liveInflight = null;
    });
    return this.liveInflight;
  };

  private tickHistory = async () => {
    if (this.historyInflight) return this.historyInflight;
    this.historyInflight = (async () => {
      try {
        const res = await fetch("/api/pv/history", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as HistoryResponse;
        this.lastHistoryAt = Date.now();
        this.state = {
          ...this.state,
          history: {
            today: payload.today,
            week: payload.week,
            month: payload.month,
            year: payload.year,
            lifetime: payload.lifetime,
          },
          historySource: payload.source,
          historyError: null,
        };
        this.emit();
      } catch {
        if (this.state.history != null) return;
        this.state = {
          ...this.state,
          historyError: "Verlaufsdaten konnten nicht geladen werden.",
        };
        this.emit();
      }
    })().finally(() => {
      this.historyInflight = null;
    });
    return this.historyInflight;
  };

  private refreshHistoryIfStale(minAgeMs: number) {
    if (this.lastHistoryAt != null && Date.now() - this.lastHistoryAt < minAgeMs) return;
    void this.tickHistory();
  }

  private stopTimers() {
    if (this.liveIntervalId) {
      clearInterval(this.liveIntervalId);
      this.liveIntervalId = null;
    }
    if (this.historyIntervalId) {
      clearInterval(this.historyIntervalId);
      this.historyIntervalId = null;
    }
  }

  private startTimers() {
    if (typeof document === "undefined" || document.hidden) return;
    if (this.liveIntervalId) return;
    void this.tickLive();
    this.refreshHistoryIfStale(HISTORY_INTERVAL_MS);
    this.liveIntervalId = setInterval(() => void this.tickLive(), LIVE_INTERVAL_MS);
    this.historyIntervalId = setInterval(
      () => void this.tickHistory(),
      HISTORY_INTERVAL_MS,
    );
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.stopTimers();
      return;
    }
    this.startTimers();
  };

  private ensureRunning() {
    if (typeof document === "undefined") return;
    if (!this.visibilityBound) {
      document.addEventListener("visibilitychange", this.onVisibility);
      this.visibilityBound = true;
    }
    this.startTimers();
  }

  private stopAll() {
    this.stopTimers();
    if (this.visibilityBound && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.visibilityBound = false;
    }
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    this.ensureRunning();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopAll();
    };
  };

  getSnapshot = (): PvStoreState => this.state;

  getServerSnapshot = (): PvStoreState => INITIAL_STATE;

  refresh = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    void this.tickLive();
    if (this.state.history == null) void this.tickHistory();
  };

  /** Diagramm-Zeitraum gewechselt: Verlauf neu holen, wenn er älter als eine Minute ist. */
  refreshHistory = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    this.refreshHistoryIfStale(HISTORY_RANGE_MIN_AGE_MS);
  };
}

export const pvStore = new PvStore();
