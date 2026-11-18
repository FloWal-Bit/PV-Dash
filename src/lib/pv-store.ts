import type { DataSource, GridSource, PvHistory } from "@/lib/pv-source";
import type { PvSnapshot } from "@/lib/pv-data";
import { applyLiveDevSettings, ensureDevSettingsReady } from "@/lib/dev-settings-sync";
import type { SharedDevSettings } from "@/lib/dev-settings-shared";
import {
  readOfflineDashboardCache,
  writeOfflineDashboardCache,
} from "@/lib/offline-dashboard-cache";
import {
  isScheduledServerPause,
  msUntilNextZurichMidnight,
  msUntilScheduledPauseEnd,
  msUntilScheduledPauseStart,
  zurichDayKey,
} from "@/lib/server-pause-window";
import { isWhatWattFirstMessageWarmup } from "@/lib/whatwatt-warmup";

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
/** Oft genug, damit der Server die 5-Minuten-Reihe tagsüber alle 45 Minuten neu holen kann. */
const HISTORY_INTERVAL_MS = 15 * 60 * 1000;
/** Beim Wechsel des Diagramm-Zeitraums neu laden, wenn der Stand älter ist. */
const HISTORY_RANGE_MIN_AGE_MS = 60_000;
/**
 * In der geplanten Nachtpause (23:30–06:00): nur selten prüfen, ob der Node
 * wieder da ist — kein 15-s-Hämmern gegen 502.
 */
const PAUSE_PROBE_INTERVAL_MS = 20 * 60_000;
/** Letzter frischer Abruf vor der Node-Pause — Offline-Cache für die Nacht. */
const SLEEP_SNAPSHOT_LEAD_MS = 3 * 60_000;
/** Nach whatwatt-Warmup (erste MQTT-Nachricht fehlt) einmal nachziehen. */
const WHATWATT_WARMUP_RETRY_MS = 8_000;

function nextLiveDelayMs(nowMs = Date.now()): number {
  if (!isScheduledServerPause(nowMs)) return LIVE_INTERVAL_MS;
  const untilEnd = msUntilScheduledPauseEnd(nowMs);
  // Spätestens kurz nach Pause-Ende wieder anklopfen.
  return Math.min(PAUSE_PROBE_INTERVAL_MS, Math.max(5_000, untilEnd + 2_000));
}

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

/**
 * true, wenn Live- oder History-Stand noch vom vorherigen Zurich-Kalendertag ist
 * (typisch: Offline-Cache vom Schlaf-Snapshot ~23:27).
 */
export function isPreviousZurichDayData(
  state: Pick<PvStoreState, "lastFetchedAt" | "snapshot" | "history">,
  nowMs: number = Date.now(),
): boolean {
  const today = zurichDayKey(nowMs);
  if (state.lastFetchedAt != null && zurichDayKey(state.lastFetchedAt) !== today) {
    return true;
  }
  if (state.snapshot?.timestamp != null && zurichDayKey(state.snapshot.timestamp) !== today) {
    return true;
  }
  const heute = state.history?.week?.find((point) => point.label === "Heute");
  if (heute?.dayKey && heute.dayKey !== today) {
    return true;
  }
  return false;
}

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
 * Live-Zahlen alle 15 Sekunden (in der Nachtpause nur ~20‑Min-Probe),
 * Verläufe alle 15 Minuten — History in der Pause ausgesetzt, bis Live wieder
 * ok ist. Beides pausiert, solange der Tab im Hintergrund ist.
 * Steht der Stand noch auf dem Vortag (Offline-Cache), wird ausserhalb der
 * Pause sofort Live + History neu geladen.
 */
class PvStore {
  private listeners = new Set<Listener>();
  private state: PvStoreState =
    typeof window === "undefined" ? INITIAL_STATE : hydrateFromOfflineCache();
  private liveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private historyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private sleepSnapshotTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private dayRolloverTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private whatwattWarmupRetryId: ReturnType<typeof setTimeout> | null = null;
  private visibilityBound = false;
  private liveInflight: Promise<void> | null = null;
  private historyInflight: Promise<void> | null = null;
  private lastHistoryAt: number | null = null;
  /** Zurich-Tag, für den zuletzt ein Vortags-Zwangsrefresh lief (Dedupe). */
  private previousDayRefreshFor: string | null = null;

  private emit() {
    for (const listener of [...this.listeners]) listener();
  }

  private persistOffline() {
    if (!this.state.snapshot || this.state.source == null) return;
    // Warmup-Warnung nicht cachen — sonst blitzt sie beim nächsten App-Start erneut auf.
    const warning = isWhatWattFirstMessageWarmup(this.state.warning) ? null : this.state.warning;
    const gridWarning = isWhatWattFirstMessageWarmup(this.state.gridWarning)
      ? null
      : this.state.gridWarning;
    writeOfflineDashboardCache({
      savedAt: this.state.lastFetchedAt ?? Date.now(),
      live: {
        source: this.state.source,
        gridSource: this.state.gridSource,
        snapshot: this.state.snapshot,
        forecastedTodayYieldKwh: this.state.forecastedTodayYieldKwh,
        forecastedTomorrowYieldKwh: this.state.forecastedTomorrowYieldKwh,
        forecastSolarError: this.state.forecastSolarError,
        warning,
        sourceWarning: this.state.sourceWarning,
        gridWarning,
      },
      history:
        this.state.history && this.state.historySource
          ? { ...this.state.history, source: this.state.historySource }
          : null,
    });
  }

  private tickLive = async () => {
    if (this.liveInflight) return this.liveInflight;
    const wasUnreachable = this.state.serverUnreachable;
    const historyFromPreviousDay = isPreviousZurichDayData(this.state);
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
        // Nach Offline/Pause oder wenn History noch vom Vortag: Verlauf sofort.
        if (wasUnreachable || historyFromPreviousDay) {
          this.lastHistoryAt = null;
          void this.tickHistory();
        }
        this.armWhatWattWarmupRetry(
          payload.warning ?? payload.gridWarning ?? null,
        );
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

  /**
   * Offline-Cache / offener Tab vom Vortag: ausserhalb der Pause sofort
   * Live + History neu laden (nicht auf 15‑Min-History-Intervall warten).
   */
  private refreshIfPreviousZurichDay() {
    if (typeof document !== "undefined" && document.hidden) return;
    if (isScheduledServerPause()) return;
    if (!isPreviousZurichDayData(this.state)) {
      this.previousDayRefreshFor = null;
      return;
    }
    const today = zurichDayKey();
    if (this.previousDayRefreshFor === today) return;
    this.previousDayRefreshFor = today;
    this.lastHistoryAt = null;
    void this.tickLive();
    void this.tickHistory();
  }

  /** whatwatt noch ohne erste MQTT-Nachricht: still nachziehen statt Banner. */
  private armWhatWattWarmupRetry(warning: string | null) {
    if (!isWhatWattFirstMessageWarmup(warning)) {
      if (this.whatwattWarmupRetryId) {
        clearTimeout(this.whatwattWarmupRetryId);
        this.whatwattWarmupRetryId = null;
      }
      return;
    }
    if (this.whatwattWarmupRetryId) return;
    if (typeof document !== "undefined" && document.hidden) return;
    this.whatwattWarmupRetryId = setTimeout(() => {
      this.whatwattWarmupRetryId = null;
      void this.tickLive();
    }, WHATWATT_WARMUP_RETRY_MS);
  }

  private stopTimers() {
    if (this.liveTimeoutId) {
      clearTimeout(this.liveTimeoutId);
      this.liveTimeoutId = null;
    }
    if (this.historyTimeoutId) {
      clearTimeout(this.historyTimeoutId);
      this.historyTimeoutId = null;
    }
    if (this.sleepSnapshotTimeoutId) {
      clearTimeout(this.sleepSnapshotTimeoutId);
      this.sleepSnapshotTimeoutId = null;
    }
    if (this.dayRolloverTimeoutId) {
      clearTimeout(this.dayRolloverTimeoutId);
      this.dayRolloverTimeoutId = null;
    }
    if (this.whatwattWarmupRetryId) {
      clearTimeout(this.whatwattWarmupRetryId);
      this.whatwattWarmupRetryId = null;
    }
  }

  private armLiveTimer() {
    if (typeof document === "undefined" || document.hidden) return;
    if (this.liveTimeoutId) clearTimeout(this.liveTimeoutId);
    const delay = nextLiveDelayMs();
    this.liveTimeoutId = setTimeout(() => {
      this.liveTimeoutId = null;
      void this.tickLive().finally(() => {
        this.refreshIfPreviousZurichDay();
        this.armLiveTimer();
      });
    }, delay);
  }

  private armHistoryTimer() {
    if (typeof document === "undefined" || document.hidden) return;
    if (this.historyTimeoutId) clearTimeout(this.historyTimeoutId);
    // In der Nachtpause kein History-Poll — Live-Probe reicht; nach Erfolg tickHistory.
    if (isScheduledServerPause()) {
      const delay = Math.min(
        PAUSE_PROBE_INTERVAL_MS,
        Math.max(5_000, msUntilScheduledPauseEnd() + 2_000),
      );
      this.historyTimeoutId = setTimeout(() => {
        this.historyTimeoutId = null;
        this.armHistoryTimer();
      }, delay);
      return;
    }
    // Direkt nach Pause-Ende: nicht erst 15 Min warten, wenn Stand noch vom Vortag.
    if (isPreviousZurichDayData(this.state)) {
      this.lastHistoryAt = null;
      void this.tickHistory().finally(() => this.armHistoryTimer());
      return;
    }
    this.historyTimeoutId = setTimeout(() => {
      this.historyTimeoutId = null;
      void this.tickHistory().finally(() => this.armHistoryTimer());
    }, HISTORY_INTERVAL_MS);
  }

  /**
   * Kurz vor 23:30 einmal Live + History holen und in den Offline-Cache schreiben,
   * damit Card 1–3 über die Node-Pause frische Werte zeigen.
   */
  private async takeSleepSnapshot() {
    if (typeof document !== "undefined" && document.hidden) return;
    if (isScheduledServerPause()) return;
    await this.tickLive();
    await this.tickHistory();
  }

  private armSleepSnapshotTimer() {
    if (typeof document === "undefined" || document.hidden) return;
    if (this.sleepSnapshotTimeoutId) {
      clearTimeout(this.sleepSnapshotTimeoutId);
      this.sleepSnapshotTimeoutId = null;
    }
    if (isScheduledServerPause()) return;
    const untilStart = msUntilScheduledPauseStart();
    const delay = Math.max(5_000, untilStart - SLEEP_SNAPSHOT_LEAD_MS);
    this.sleepSnapshotTimeoutId = setTimeout(() => {
      this.sleepSnapshotTimeoutId = null;
      void this.takeSleepSnapshot();
    }, delay);
  }

  /** Bei Zurich-Mitternacht (offener Tab) Stand als Vortag erkennen und neu laden. */
  private armDayRolloverTimer() {
    if (typeof document === "undefined" || document.hidden) return;
    if (this.dayRolloverTimeoutId) {
      clearTimeout(this.dayRolloverTimeoutId);
      this.dayRolloverTimeoutId = null;
    }
    const delay = msUntilNextZurichMidnight();
    this.dayRolloverTimeoutId = setTimeout(() => {
      this.dayRolloverTimeoutId = null;
      this.previousDayRefreshFor = null;
      this.refreshIfPreviousZurichDay();
      this.armDayRolloverTimer();
    }, delay);
  }

  private startTimers() {
    if (typeof document === "undefined" || document.hidden) return;
    if (this.liveTimeoutId) return;
    if (!isScheduledServerPause() && isPreviousZurichDayData(this.state)) {
      this.refreshIfPreviousZurichDay();
    } else {
      void this.tickLive();
      if (!isScheduledServerPause()) {
        this.refreshHistoryIfStale(HISTORY_INTERVAL_MS);
      }
    }
    this.armLiveTimer();
    this.armHistoryTimer();
    this.armSleepSnapshotTimer();
    this.armDayRolloverTimer();
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
    if (this.state.history == null || isPreviousZurichDayData(this.state)) {
      this.lastHistoryAt = null;
      void this.tickHistory();
    }
  };

  /** Live-Zahlen und Verläufe sofort neu vom eigenen Server lesen. */
  reload = () => {
    void this.tickLive();
    void this.tickHistory();
  };

  /** Diagramm-Zeitraum gewechselt: Verlauf neu holen, wenn er älter als eine Minute ist. */
  refreshHistory = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (isPreviousZurichDayData(this.state)) {
      this.lastHistoryAt = null;
      void this.tickHistory();
      return;
    }
    this.refreshHistoryIfStale(HISTORY_RANGE_MIN_AGE_MS);
  };
}

export const pvStore = new PvStore();
