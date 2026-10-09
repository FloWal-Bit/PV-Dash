/**
 * Blendet simulierte Anlagenwerte aus. Standard ist ausblenden, damit ohne
 * FusionSolar keine erfundenen Ertrags- und Verbrauchszahlen dastehen.
 * Die Wahl liegt in localStorage.
 */

const STORAGE_KEY = "pv-dash:hide-simulated";

type Listener = () => void;
const listeners = new Set<Listener>();
let hideSimulated = true;

function readStored(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw == null) return true;
  return raw === "1";
}

function emit() {
  for (const listener of listeners) listener();
}

export const hideSimulatedStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      const next = readStored();
      if (next !== hideSimulated) {
        hideSimulated = next;
        emit();
      }
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): boolean {
    return hideSimulated;
  },
  getServerSnapshot(): boolean {
    return true;
  },
  set(hide: boolean): void {
    hideSimulated = hide;
    window.localStorage.setItem(STORAGE_KEY, hide ? "1" : "0");
    emit();
  },
};
