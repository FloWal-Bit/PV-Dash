/**
 * Haptisches Feedback über die Vibration API (Android Chrome / PWA).
 * iOS: No-Op. Auf Android in den Einstellungen abschaltbar.
 *
 * Hinweis: Impulse unter ~20 ms spüren viele Geräte nicht. Chrome verlangt
 * zudem sticky user activation (mindestens ein Tipp seit dem Laden).
 */

export type HapticKind = "selection" | "tab" | "confirm";

const STORAGE_KEY = "pv-dash:haptics-enabled";

/** Dauer in ms — bewusst spürbar, nicht nur API-Mindestwert. */
const PATTERNS: Record<HapticKind, number | number[]> = {
  /** Chart-Scrubben: kurzer Tick. */
  selection: 28,
  /** Tab-Wechsel. */
  tab: 45,
  /** Testimpuls beim Einschalten in den Einstellungen. */
  confirm: 60,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot = true;

function refreshSnapshot() {
  snapshot = readHapticsEnabled();
}

export function readHapticsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeHapticsEnabled(enabled: boolean) {
  window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  snapshot = enabled;
  for (const listener of listeners) listener();
}

export const hapticsEnabledStore = {
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
  setEnabled(enabled: boolean): void {
    writeHapticsEnabled(enabled);
  },
};

export function canUseHaptics(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function triggerHaptic(kind: HapticKind = "selection"): void {
  if (typeof navigator === "undefined") return;
  if (!readHapticsEnabled()) return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    // Vorherige Vibration abbrechen, sonst verschluckt Android kurze Folgeimpulse.
    navigator.vibrate(0);
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // ältere WebViews / Permission
  }
}
