import {
  evaluateSurplusAlert,
  SURPLUS_ALERT_COOLDOWN_MS,
  type SurplusAlertSettings,
} from "@/lib/dev-settings-shared";
import { formatKw, formatYieldKwh } from "@/lib/format";
import { currentPushAlertState, thisDeviceReceivesPush } from "@/lib/push-alert-settings";
import { APP_ICON_SRC } from "@/lib/version";

/**
 * Push-Benachrichtigungen bei Ertrags-Meilensteinen.
 *
 * Es gibt (bewusst) keinen eigenen Push-Server/Service-Worker-Abo-Flow –
 * dafür bräuchte es VAPID-Schlüssel und eine Backend-Anbindung. Stattdessen
 * nutzen wir die Browser-Notification-API direkt im Client: Sobald das
 * Dashboard offen ist (Tab im Vorder- oder Hintergrund), die Berechtigung
 * erteilt wurde und das Gerät in den Dev-Einstellungen als Empfänger
 * eingetragen ist. Der Tagesertrag meldet sich einmal pro Tag ab 3 kWh.
 * Der Stromüberschuss folgt der dort gespeicherten kW-Schwelle, den
 * Wochentagen und der Uhrzeit.
 */

export const YIELD_NOTIFICATION_THRESHOLD_KWH = 3;

const ENABLED_KEY = "pv-dash:notifications-enabled";
const LAST_FIRED_DATE_KEY = "pv-dash:notifications-last-fired-date";
const SURPLUS_ACTIVE_KEY = "pv-dash:surplus-alert-active";
const SURPLUS_FIRED_AT_KEY = "pv-dash:surplus-alert-fired-at";
/** Ältere Messwerte (Offline-Cache) lösen keine Überschuss-Meldung aus. */
const SURPLUS_MAX_SAMPLE_AGE_MS = 2 * 60 * 1000;

export type NotificationPermissionState = "unsupported" | NotificationPermission;

export type NotificationSettingsState = {
  /** Vom Nutzer gewünschter Zustand (persistiert in localStorage). */
  enabled: boolean;
  /** Tatsächlicher Berechtigungsstatus des Browsers. */
  permission: NotificationPermissionState;
};

function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function readEnabledFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "true";
}

function readPermission(): NotificationPermissionState {
  if (!isSupported()) return "unsupported";
  return Notification.permission;
}

function computeState(): NotificationSettingsState {
  const permission = readPermission();
  // Ein "true" in localStorage zählt nur, solange der Browser die
  // Berechtigung nicht zwischenzeitlich entzogen hat.
  return { enabled: readEnabledFromStorage() && permission === "granted", permission };
}

const SERVER_STATE: NotificationSettingsState = { enabled: false, permission: "unsupported" };

type Listener = () => void;
const listeners = new Set<Listener>();
let state: NotificationSettingsState = SERVER_STATE;

function emit() {
  for (const listener of listeners) listener();
}

export const notificationSettingsStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): NotificationSettingsState {
    return state;
  },
  getServerSnapshot(): NotificationSettingsState {
    return SERVER_STATE;
  },
  /** Fordert bei Bedarf die Browser-Berechtigung an und aktiviert die Benachrichtigungen bei Erfolg. */
  async enable(): Promise<NotificationSettingsState> {
    if (!isSupported()) {
      state = { enabled: false, permission: "unsupported" };
      emit();
      return state;
    }
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    const enabled = permission === "granted";
    window.localStorage.setItem(ENABLED_KEY, String(enabled));
    state = { enabled, permission };
    emit();
    return state;
  },
  disable(): void {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ENABLED_KEY, "false");
    }
    state = { ...state, enabled: false };
    emit();
  },
};

if (typeof window !== "undefined") {
  state = computeState();
  // Berechtigung kann sich außerhalb der App ändern (Browser-Einstellungen) –
  // beim Zurückkehren in den Tab einmal neu abgleichen.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const next = computeState();
      if (next.enabled !== state.enabled || next.permission !== state.permission) {
        state = next;
        emit();
      }
    }
  });
}

function todayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export type TestNotificationResult = "shown" | "unsupported" | "denied" | "failed";

/**
 * Android Chrome (auch als installierte App) ignoriert `new Notification()`,
 * solange die Seite offen ist, und wirft oft «Illegal constructor».
 * Die Anzeige läuft deshalb über den Service Worker. Der Konstruktor bleibt
 * der Fallback für Desktop-Browser ohne aktiven Worker.
 */
async function showNotification(
  body: string,
  tag: string,
  renotify = false,
): Promise<TestNotificationResult> {
  if (typeof window === "undefined" || !isSupported()) return "unsupported";
  if (Notification.permission !== "granted") return "denied";

  const options: NotificationOptions = {
    body,
    tag,
    renotify,
    icon: APP_ICON_SRC,
  };

  try {
    if (await showThroughServiceWorker(options)) return "shown";
  } catch {
    // Worker da, Anzeige trotzdem fehlgeschlagen — Konstruktor versuchen.
  }
  return showThroughConstructor(options) ? "shown" : "failed";
}

async function showThroughServiceWorker(options: NotificationOptions): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), 2500);
    }),
  ]);
  if (!registration) return false;
  try {
    await registration.showNotification("PV Dash", options);
  } catch {
    await registration.showNotification("PV Dash", {
      body: options.body,
      tag: options.tag,
      renotify: options.renotify,
    });
  }
  return true;
}

function showThroughConstructor(options: NotificationOptions): boolean {
  try {
    new Notification("PV Dash", options);
    return true;
  } catch {
    try {
      new Notification("PV Dash", { body: options.body, tag: options.tag });
      return true;
    } catch {
      return false;
    }
  }
}

function showYieldNotification(todayYieldKwh: number): void {
  void showNotification(
    `Deine Anlage hat heute bereits ${formatYieldKwh(todayYieldKwh, 1)} erzeugt.`,
    "pv-yield-threshold",
  );
}

function showSurplusNotification(exportKw: number): void {
  void showNotification(`Stromüberschuss: ${formatKw(exportKw)} Einspeisung.`, "pv-surplus");
}

function pushReadyOnThisDevice(): boolean {
  return state.enabled && state.permission === "granted" && thisDeviceReceivesPush();
}

/**
 * Prüft, ob der heutige Ertrag die Schwelle überschritten hat, und löst
 * höchstens einmal pro Kalendertag eine Benachrichtigung aus. Wird bei
 * jedem neuen Datenstand (Polling-Takt des Dashboards) aufgerufen.
 */
export function checkYieldNotification(todayYieldKwh: number, timestamp: number): void {
  if (typeof window === "undefined") return;
  if (!pushReadyOnThisDevice()) return;
  if (todayYieldKwh <= YIELD_NOTIFICATION_THRESHOLD_KWH) return;

  const today = todayKey(timestamp);
  if (window.localStorage.getItem(LAST_FIRED_DATE_KEY) === today) return;

  window.localStorage.setItem(LAST_FIRED_DATE_KEY, today);
  showYieldNotification(todayYieldKwh);
}

function readSurplusActive(): boolean {
  return window.localStorage.getItem(SURPLUS_ACTIVE_KEY) === "1";
}

function readSurplusFiredAt(): number | null {
  const raw = window.localStorage.getItem(SURPLUS_FIRED_AT_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Mitteilung, wenn die Einspeisung die gespeicherte Schwelle im Tages- und
 * Zeitfenster erreicht. Höchstens einmal pro Überschuss-Phase.
 * `timestamp` ist der Messzeitpunkt; deutlich ältere Werte werden ignoriert.
 */
export function checkSurplusNotification(
  gridKw: number | null,
  timestamp: number,
  nowMs: number = Date.now(),
): void {
  if (typeof window === "undefined") return;
  if (!pushReadyOnThisDevice()) return;
  if (!Number.isFinite(timestamp) || Math.abs(nowMs - timestamp) > SURPLUS_MAX_SAMPLE_AGE_MS) return;

  const settings: SurplusAlertSettings = currentPushAlertState().surplus;
  const decision = evaluateSurplusAlert({
    now: new Date(nowMs),
    gridKw,
    settings,
    wasActive: readSurplusActive(),
    lastFiredAt: readSurplusFiredAt(),
    cooldownMs: SURPLUS_ALERT_COOLDOWN_MS,
  });
  window.localStorage.setItem(SURPLUS_ACTIVE_KEY, decision.active ? "1" : "0");
  if (!decision.fire || decision.exportKw == null) return;
  window.localStorage.setItem(SURPLUS_FIRED_AT_KEY, String(nowMs));
  showSurplusNotification(decision.exportKw);
}

/**
 * Löst sofort eine Test-Benachrichtigung aus (unabhängig von Schwelle, Tag und Geräteliste).
 * Eigenes Tag mit `renotify`, damit ein erneuter Tipp wieder einen Hinweis auslöst
 * und keine echte Überschuss-Meldung ersetzt.
 */
export function sendTestNotification(): Promise<TestNotificationResult> {
  const minKw = currentPushAlertState().surplus.minKw;
  return showNotification(
    `Stromüberschuss: ${formatKw(minKw > 0 ? minKw : 1)} Einspeisung.`,
    "pv-dash-test",
    true,
  );
}
