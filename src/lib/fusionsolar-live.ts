/**
 * Steuert, ob das Dashboard FusionSolar nach Livedaten fragt.
 * Standard ist aus, damit Huawei nicht ungefragt aufgerufen wird.
 * Die Wahl liegt in localStorage.
 */

const STORAGE_KEY = "pv-dash:fusionsolar-live";

type Listener = () => void;
const listeners = new Set<Listener>();
let enabled = false;

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

function emit() {
  for (const listener of listeners) listener();
}

export const fusionsolarLiveStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      const next = readStored();
      if (next !== enabled) {
        enabled = next;
        emit();
      }
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): boolean {
    return enabled;
  },
  getServerSnapshot(): boolean {
    return false;
  },
  set(next: boolean): void {
    enabled = next;
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    emit();
  },
};
