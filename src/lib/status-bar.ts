import { isAndroidBrowser, isInstalledApp, isIosBrowser } from "@/lib/install-prompt";

const STORAGE_KEY = "pv-dash:hide-status-bar";

/**
 * Chrome auf Android und Safari auf iOS/iPadOS zeigen beim Eintritt in die
 * Fullscreen-API den Systemtoast «zum Beenden des Vollbildmodus: von oben
 * ziehen». Installierte Home-Bildschirm-Apps haben die Browserleiste bereits
 * ausgeblendet. Dort die API nicht aufrufen.
 */
export function mustNotRequestDocumentFullscreen(): boolean {
  return isAndroidBrowser() || isIosBrowser() || isInstalledApp();
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
  if (mustNotRequestDocumentFullscreen()) {
    writeHideStatusBar(true);
    return true;
  }
  if (typeof document.documentElement.requestFullscreen !== "function") {
    return false;
  }
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    writeHideStatusBar(true);
    return true;
  } catch {
    writeHideStatusBar(false);
    return false;
  }
}
