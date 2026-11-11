import { isIosBrowser } from "@/lib/install-prompt";

const STORAGE_KEY = "pv-dash:hide-status-bar";

/**
 * Document-Fullscreen (navigationUI: hide) blendet auf Android/Chrome
 * Status- und Navigationsleiste aus. iOS unterstützt die API nicht.
 */
export function mustNotRequestDocumentFullscreen(): boolean {
  return isIosBrowser();
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot = true;

/** true, wenn exitFullscreen bewusst vom Toggle (Leisten anzeigen) kam. */
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

function isDisplayModeFullscreen(): boolean {
  return window.matchMedia("(display-mode: fullscreen)").matches;
}

/**
 * Heuristik: Systemleisten (Status/Navi) nehmen sichtbare Höhe weg.
 * In sauberem PWA-Fullscreen ist innerHeight ≈ screen.height — dann keinen
 * Extra-Document-Fullscreen anfordern (vermeidet Chrome-Toast).
 */
export function systemChromeLikelyVisible(): boolean {
  if (typeof window === "undefined") return false;
  if (document.fullscreenElement) return false;
  const screenH = window.screen?.height ?? 0;
  if (screenH <= 0) return true;
  return window.innerHeight < screenH - 24;
}

/**
 * true, wenn Document-Fullscreen nötig ist, um Status+Navi auszublenden.
 * PWA mit display:fullscreen und bereits voller Höhe: false.
 */
export function needsImmersiveDocumentFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  if (!readHideStatusBar()) return false;
  if (document.fullscreenElement) return false;
  if (mustNotRequestDocumentFullscreen()) return false;
  if (!isDisplayModeFullscreen()) return true;
  return systemChromeLikelyVisible();
}

type FullscreenElement = Element & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
};

/**
 * Immersives Document-Fullscreen: Status- und Navigationsleiste aus
 * (navigationUI: "hide").
 */
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

/** Preference: Systemleisten (Status + Navi) ausblenden bzw. wieder anzeigen. */
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
  if (!needsImmersiveDocumentFullscreen()) {
    return true;
  }
  await requestHideStatusBarFullscreen();
  // Preference bleibt an — Controller retried / Tipp, falls Request scheitert.
  return true;
}
