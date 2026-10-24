const STORAGE_KEY = "pv-dash:hide-status-bar";

type ChromeClientHints = {
  platform?: string;
  brands?: { brand: string }[];
};

/**
 * Android, including Chrome. Matches an Android user agent, or Chrome when its
 * client hints report platform Android (reduced UA strings omit the token).
 * Desktop Chrome does not match and may still use the Fullscreen API.
 */
export function isAndroidClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent ?? "";
  const hints = (navigator as Navigator & { userAgentData?: ChromeClientHints }).userAgentData;
  const platform = hints?.platform ?? "";
  const brands = hints?.brands?.map((brand) => brand.brand).join(" ") ?? "";
  const androidUserAgent = /Android/i.test(userAgent);
  const chrome = /Chrome|Chromium/i.test(userAgent) || /Chrome|Chromium/i.test(brands);
  const chromeOnAndroid = chrome && /Android/i.test(platform);
  return androidUserAgent || chromeOnAndroid;
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

/**
 * Requests document fullscreen. Chrome on Android shows the system hint
 * "zum Beenden des Vollbildmodus: von oben ziehen" for this API, and CSS
 * cannot hide it, so Android returns false before requestFullscreen or
 * webkitRequestFullscreen. The installed PWA display mode is unchanged.
 */
export async function requestDocumentFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (isAndroidClient()) return false;
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== "function") return false;
  await root.requestFullscreen({ navigationUI: "hide" });
  return true;
}

/** Blendet die System-Statusleiste aus, sofern der Browser den Vollbildmodus erlaubt. */
export async function setHideStatusBar(hide: boolean): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (!hide) {
    writeHideStatusBar(false);
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    return true;
  }
  if (isAndroidClient()) {
    writeHideStatusBar(true);
    return true;
  }
  try {
    const entered = await requestDocumentFullscreen();
    if (!entered) return false;
    writeHideStatusBar(true);
    return true;
  } catch {
    writeHideStatusBar(false);
    return false;
  }
}
