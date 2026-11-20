/**
 * Blendet simulierte Anlagenwerte ein. Standard ist aus.
 * Die Wahl liegt auf dem Server und gilt für alle Geräte.
 */

const STORAGE_KEY = "pv-dash:show-simulated";
const LEGACY_KEY = "pv-dash:hide-simulated";

type Listener = () => void;
const listeners = new Set<Listener>();
let showSimulated = false;

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "1" || raw === "0") return raw === "1";
  const legacy = window.localStorage.getItem(LEGACY_KEY);
  if (legacy === "1" || legacy === "0") {
    const show = legacy === "0";
    window.localStorage.setItem(STORAGE_KEY, show ? "1" : "0");
    window.localStorage.removeItem(LEGACY_KEY);
    return show;
  }
  return false;
}

function emit() {
  for (const listener of listeners) listener();
}

export const showSimulatedStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      const next = readStored();
      if (next !== showSimulated) {
        showSimulated = next;
        emit();
      }
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): boolean {
    return showSimulated;
  },
  getServerSnapshot(): boolean {
    return false;
  },
  set(show: boolean): Promise<void> {
    showSimulated = show;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, show ? "1" : "0");
      window.localStorage.removeItem(LEGACY_KEY);
    }
    emit();
    return import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
      putDevSettings({ showSimulated: show }).then(() => undefined),
    );
  },
  applyRemote(show: boolean): void {
    showSimulated = show;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, show ? "1" : "0");
      window.localStorage.removeItem(LEGACY_KEY);
    }
    emit();
  },
};
