import type { DataSource, GridSource, PvHistory } from "@/lib/pv-source";
import type { PvSnapshot } from "@/lib/pv-data";
import { applyLiveDevSettings, ensureDevSettingsReady } from "@/lib/dev-settings-sync";
import type { SharedDevSettings } from "@/lib/dev-settings-shared";
import {
  readOfflineDashboardCache,
  writeOfflineDashboardCache,
} from "@/lib/offline-dashboard-cache";

export type PvStoreState = {
  snapshot: PvSnapshot | null;
  error: string | null;
  source: DataSource | null;
  gridSource: GridSource;
  forecastedTodayYieldKwh: number | null;
  forecastedTomorrowYieldKwh: number | null;
  forecastSolarError: string | null;
  warning: string | null;
  sourceWarning: string | null;
  gridWarning: string | null;
  /** Client-Zeitpunkt des letzten erfolgreichen Live-Abrufs (für „Aktualisiert“). */
  lastFetchedAt: number | null;
  history: PvHistory | null;
  historySource: DataSource | null;
  historyError: string | null;
  /** true, wenn der letzte Live-Abruf fehlschlug (Server/Netz). */
  serverUnreachable: boolean;
  /**
   * true nach dem ersten Live-Abruf (Erfolg oder Fehler).
   * Verhindert, dass der Offline-Cache beim Refresh fälschlich
   * «Server nicht erreichbar» aufblitzen lässt.
   */
  liveProbeDone: boolean;
};

const LIVE_INTERVAL_MS = 15_000;
/** Oft genug, damit der Server die 5-Minuten-Reihe tagsüber alle 50 Minuten neu holen kann. */
const HISTORY_INTERVAL_MS = 15 * 60 * 1000;
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
  sourceWarning: null,
  gridWarning: null,
  lastFetchedAt: null,
  history: null,
  historySource: null,
  historyError: null,
  serverUnreachable: false,
  liveProbeDone: false,
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
  sourceWarning: string | null;
  gridWarning: string | null;
  devSettings?: SharedDevSettings;
};

type HistoryResponse = PvHistory & { source: DataSource };

function hydrateFromOfflineCache(): PvStoreState {
  const cached = readOfflineDashboardCache();
  if (!cached) return INITIAL_STATE;
  return {
    ...INITIAL_STATE,
    snapshot: cached.live.snapshot,
    source: cached.live.source,
    gridSource: cached.live.gridSource,
    forecastedTodayYieldKwh: cached.live.forecastedTodayYieldKwh,
    forecastedTomorrowYieldKwh: cached.live.forecastedTomorrowYieldKwh,
    forecastSolarError: cached.live.forecastSolarError,
    warning: cached.live.warning,
    sourceWarning: cached.live.sourceWarning,
    gridWarning: cached.live.gridWarning,
    lastFetchedAt: cached.savedAt,
    history: cached.history
      ? {
          today: cached.history.today,
          week: cached.history.week,
          month: cached.history.month,
          year: cached.history.year,
          lifetime: cached.history.lifetime,
        }
      : null,
    historySource: cached.history?.source ?? null,
    // Noch nicht als unreachable markieren — erst nach fehlgeschlagenem Abruf.
    serverUnreachable: false,
    liveProbeDone: false,
  };
}

/**
 * Live-Zahlen alle 15 Sekunden, Verläufe einmal pro Stunde. Beides pausiert,
 * solange der Tab im Hintergrund ist. whatwatt liefert etwa alle 15 Sekunden
 * einen neuen Zählerstand. Huawei-Livedaten holt der Server höchstens alle
 * 6 Minuten, die heutige Stundenreihe einmal pro Stunde, längere Reihen
 * zweimal täglich.
 */
class PvStore {
  private listeners = new Set<Listener>();
  private state: PvStoreState =
    typeof window === "undefined" ? INITIAL_STATE : hydrateFromOfflineCache();
  private liveIntervalId: ReturnType<typeof setInterval> | null = null;
  private historyIntervalId: ReturnType<typeof setInterval> | null = null;
  private visibilityBound = false;
  private liveInflight: Promise<void> | null = null;
  private historyInflight: Promise<void> | null = null;
  private lastHistoryAt: number | null = null;

  private emit() {
    for (const listener of [...this.listeners]) listener();
  }

  private persistOffline() {
    if (!this.state.snapshot || this.state.source == null) return;
    writeOfflineDashboardCache({
      savedAt: this.state.lastFetchedAt ?? Date.now(),
      live: {
        source: this.state.source,
        gridSource: this.state.gridSource,
        snapshot: this.state.snapshot,
        forecastedTodayYieldKwh: this.state.forecastedTodayYieldKwh,
        forecastedTomorrowYieldKwh: this.state.forecastedTomorrowYieldKwh,
        forecastSolarError: this.state.forecastSolarError,
        warning: this.state.warning,
        sourceWarning: this.state.sourceWarning,
        gridWarning: this.state.gridWarning,
      },
      history:
        this.state.history && this.state.historySource
          ? { ...this.state.history, source: this.state.historySource }
          : null,
    });
  }

  private tickLive = async () => {
    if (this.liveInflight) return this.liveInflight;
    this.liveInflight = (async () => {
      try {
        await ensureDevSettingsReady();
        const res = await fetch("/api/pv", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as LiveResponse;
        applyLiveDevSettings(payload.devSettings);
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
          sourceWarning: payload.sourceWarning ?? null,
          gridWarning: payload.gridWarning ?? null,
          lastFetchedAt: Date.now(),
          serverUnreachable: false,
          liveProbeDone: true,
        };
        this.persistOffline();
      } catch {
        if (!this.state.snapshot) {
          const cached = hydrateFromOfflineCache();
          if (cached.snapshot) {
            this.state = {
              ...cached,
              error: null,
              serverUnreachable: true,
              liveProbeDone: true,
            };
          } else {
            this.state = {
              ...this.state,
              serverUnreachable: true,
              liveProbeDone: true,
              error:
                "Server nicht erreichbar und keine gespeicherten Werte vorhanden.",
            };
          }
        } else {
          this.state = {
            ...this.state,
            serverUnreachable: true,
            liveProbeDone: true,
            error: null,
          };
        }
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
        this.persistOffline();
        this.emit();
      } catch {
        if (this.state.history != null) return;
        const cached = readOfflineDashboardCache();
        if (cached?.history) {
          this.state = {
            ...this.state,
            history: {
              today: cached.history.today,
              week: cached.history.week,
              month: cached.history.month,
              year: cached.history.year,
              lifetime: cached.history.lifetime,
            },
            historySource: cached.history.source,
            historyError: null,
          };
          this.emit();
          return;
        }
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

  /** Live-Zahlen und Verläufe sofort neu vom eigenen Server lesen. */
  reload = () => {
    void this.tickLive();
    void this.tickHistory();
  };

  /** Diagramm-Zeitraum gewechselt: Verlauf neu holen, wenn er älter als eine Minute ist. */
  refreshHistory = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    this.refreshHistoryIfStale(HISTORY_RANGE_MIN_AGE_MS);
  };
}

export const pvStore = new PvStore();
