const STORAGE_KEY = "pv-dash:hide-status-bar";

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot = false;

function refreshSnapshot() {
  snapshot = readHideStatusBar();
}

export function readHideStatusBar(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
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
    return false;
  },
};

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
  if (typeof document.documentElement.requestFullscreen !== "function") {
    return false;
  }
  try {
    await document.documentElement.requestFullscreen();
    writeHideStatusBar(true);
    return true;
  } catch {
    writeHideStatusBar(false);
    return false;
  }
}
