type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __pvDashInstall?: BeforeInstallPromptEvent | null;
  }
}

const INSTALL_EVENT = "pv-dash:install-available";

export function subscribeInstallPrompt(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(INSTALL_EVENT, onChange);
  return () => window.removeEventListener(INSTALL_EVENT, onChange);
}

export type HomeScreenInstallState = {
  installed: boolean;
  /** Browser hat `beforeinstallprompt` geliefert und kann den Dialog selbst öffnen. */
  canInstall: boolean;
  ios: boolean;
};

const SERVER_INSTALL_STATE: HomeScreenInstallState = {
  installed: false,
  canInstall: false,
  ios: false,
};

let installState = SERVER_INSTALL_STATE;
const installListeners = new Set<() => void>();

function readHomeScreenInstallState(): HomeScreenInstallState {
  return {
    installed: isInstalledApp(),
    canInstall: canPromptInstall(),
    ios: isIosBrowser(),
  };
}

function publishHomeScreenInstallState(): void {
  const next = readHomeScreenInstallState();
  if (
    next.installed === installState.installed &&
    next.canInstall === installState.canInstall &&
    next.ios === installState.ios
  ) {
    return;
  }
  installState = next;
  for (const listener of installListeners) listener();
}

export function subscribeHomeScreenInstall(listener: () => void): () => void {
  installListeners.add(listener);
  const unsubscribePrompt = subscribeInstallPrompt(publishHomeScreenInstallState);
  return () => {
    installListeners.delete(listener);
    unsubscribePrompt();
  };
}

export function getHomeScreenInstallState(): HomeScreenInstallState {
  if (typeof window === "undefined") return installState;
  const next = readHomeScreenInstallState();
  if (
    next.installed === installState.installed &&
    next.canInstall === installState.canInstall &&
    next.ios === installState.ios
  ) {
    return installState;
  }
  installState = next;
  return installState;
}

export function getHomeScreenInstallServerState(): HomeScreenInstallState {
  return SERVER_INSTALL_STATE;
}

export function canPromptInstall(): boolean {
  return typeof window !== "undefined" && window.__pvDashInstall != null;
}

export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  const ios = window.navigator as Navigator & { standalone?: boolean };
  return (
    ios.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

export function isIosBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const iPhone = /iPad|iPhone|iPod/.test(ua);
  const iPadOs = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return iPhone || iPadOs;
}

/** Chrome auf Android zeigt beim Fullscreen-API-Eintritt den Systemtoast mit dem Hostnamen. */
export function isAndroidBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return /Android/i.test(window.navigator.userAgent);
}

export function homeScreenHint(): string {
  if (isIosBrowser()) {
    return "Tippe auf Teilen und dann auf „Zum Home-Bildschirm“.";
  }
  return "Öffne das Menü des Browsers und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.";
}

export async function promptHomeScreenInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = window.__pvDashInstall;
  if (!event) return "unavailable";
  await event.prompt();
  const choice = await event.userChoice;
  window.__pvDashInstall = null;
  window.dispatchEvent(new Event(INSTALL_EVENT));
  return choice.outcome;
}
