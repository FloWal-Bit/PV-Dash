import { isAndroidBrowser, isInstalledApp, isIosBrowser } from "@/lib/install-prompt";

const STORAGE_KEY = "pv-dash:hide-status-bar";

/**
 * Ohne Nutzer-Geste kein requestFullscreen auf Android/iOS/PWA beim
 * ersten Öffnen — sonst Systemtoast bzw. wirkungsloser Aufruf.
 * Nach Sleep/App-Wechsel (resume) und bei Tipp darf Android/PWA wieder
 * in den Document-Fullscreen, sonst bleibt die Statusleiste sichtbar.
 */
export function mustNotAutoRequestFullscreen(): boolean {
  return isAndroidBrowser() || isIosBrowser() || isInstalledApp();
}

/** Expliziter Toggle / Re-Enter: nur iOS blockieren. */
export function mustNotRequestDocumentFullscreen(): boolean {
  return isIosBrowser();
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot = true;

/** true, wenn exitFullscreen bewusst vom Toggle (Leiste anzeigen) kam. */
let intentionalFullscreenExit = false;

function refreshSnapshot() {
  snapshot = readHideStatusBar();
}

export function readHideStatusBar(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeHideStatusBar(hide: boolean) {
  window.localStorage.setItem(STORAGE_KEY, hide ? "1" : "0");
  snapshot = hide;
  listeners.forEach((listener) => listener());
}

export const hideStatusBarStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") refreshSnapshot();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): boolean {
    return snapshot;
  },
  getServerSnapshot(): boolean {
    return true;
  },
};

/** Markiert den nächsten Fullscreen-Exit als bewusst (Toggle aus). */
export function markIntentionalFullscreenExit(): void {
  intentionalFullscreenExit = true;
}

/** Liest und löscht die Intentional-Exit-Marke. */
export function consumeIntentionalFullscreenExit(): boolean {
  const value = intentionalFullscreenExit;
  intentionalFullscreenExit = false;
  return value;
}

type FullscreenElement = Element & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
};

export async function requestHideStatusBarFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (mustNotRequestDocumentFullscreen()) return false;
  if (document.fullscreenElement) return true;

  const root = document.documentElement as FullscreenElement;
  const request =
    typeof root.requestFullscreen === "function"
      ? () => root.requestFullscreen({ navigationUI: "hide" })
      : typeof root.webkitRequestFullscreen === "function"
        ? () => root.webkitRequestFullscreen()
        : null;
  if (!request) return false;

  try {
    await Promise.resolve(request());
    return document.fullscreenElement != null;
  } catch {
    return false;
  }
}

/** Blendet die System-Statusleiste aus, sofern das ohne den Vollbild-Toast geht. */
export async function setHideStatusBar(hide: boolean): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (!hide) {
    writeHideStatusBar(false);
    if (document.fullscreenElement) {
      markIntentionalFullscreenExit();
      try {
        await document.exitFullscreen();
      } catch {
        // ignore
      }
    }
    return true;
  }
  writeHideStatusBar(true);
  if (mustNotRequestDocumentFullscreen()) {
    return true;
  }
  const ok = await requestHideStatusBarFullscreen();
  if (!ok) {
    // Preference bleibt an — nächster Tipp/Wake versucht erneut.
    return true;
  }
  return true;
}
