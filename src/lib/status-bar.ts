import { isAndroidBrowser, isInstalledApp, isIosBrowser } from "@/lib/install-prompt";

const STORAGE_KEY = "pv-dash:hide-status-bar";

/**
 * Ohne Nutzer-Geste kein requestFullscreen auf Android/iOS/PWA —
 * sonst Systemtoast bzw. wirkungsloser Aufruf.
 * Mit Geste (Tipp) darf Android/PWA wieder in den Vollbildmodus.
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

export async function requestHideStatusBarFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (mustNotRequestDocumentFullscreen()) return false;
  if (typeof document.documentElement.requestFullscreen !== "function") return false;
  if (document.fullscreenElement) return true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    return true;
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
      await document.exitFullscreen();
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
