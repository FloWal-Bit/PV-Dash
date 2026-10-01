/**
 * Push-Benachrichtigungen bei Ertrags-Meilensteinen.
 *
 * Es gibt (bewusst) keinen eigenen Push-Server/Service-Worker-Abo-Flow –
 * dafür bräuchte es VAPID-Schlüssel und eine Backend-Anbindung. Stattdessen
 * nutzen wir die Browser-Notification-API direkt im Client: Sobald das
 * Dashboard offen ist (Tab im Vorder- oder Hintergrund) und die
 * Berechtigung erteilt wurde, löst eine Meldung aus, sobald der heutige
 * Ertrag die Schwelle überschreitet. Das deckt den vom Nutzer gewünschten
 * Anwendungsfall ab, ohne zusätzliche Server-Infrastruktur zu benötigen.
 */

export const YIELD_NOTIFICATION_THRESHOLD_KWH = 3;

const ENABLED_KEY = "pv-dash:notifications-enabled";
const LAST_FIRED_DATE_KEY = "pv-dash:notifications-last-fired-date";

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

function showYieldNotification(todayYieldKwh: number): void {
  if (!isSupported()) return;
  try {
    new Notification("PV Dash", {
      body: `Deine Anlage hat heute bereits ${todayYieldKwh.toFixed(1)} kWh erzeugt.`,
      icon: "/icon.svg",
      tag: "pv-yield-threshold",
    });
  } catch {
    // Manche Browser (z. B. iOS Safari im Nicht-PWA-Modus) unterstützen die
    // Notification-API technisch, werfen bei `new Notification(...)` aber
    // einen Fehler – in dem Fall lassen wir es still fehlschlagen.
  }
}

/**
 * Prüft, ob der heutige Ertrag die Schwelle überschritten hat, und löst
 * höchstens einmal pro Kalendertag eine Benachrichtigung aus. Wird bei
 * jedem neuen Datenstand (Polling-Takt des Dashboards) aufgerufen.
 */
export function checkYieldNotification(todayYieldKwh: number, timestamp: number): void {
  if (typeof window === "undefined") return;
  if (!state.enabled || state.permission !== "granted") return;
  if (todayYieldKwh <= YIELD_NOTIFICATION_THRESHOLD_KWH) return;

  const today = todayKey(timestamp);
  if (window.localStorage.getItem(LAST_FIRED_DATE_KEY) === today) return;

  window.localStorage.setItem(LAST_FIRED_DATE_KEY, today);
  showYieldNotification(todayYieldKwh);
}

/** Löst sofort eine Test-Benachrichtigung aus (unabhängig vom Schwellenwert/Tageslimit). */
export function sendTestNotification(): void {
  showYieldNotification(YIELD_NOTIFICATION_THRESHOLD_KWH + 1.2);
}
