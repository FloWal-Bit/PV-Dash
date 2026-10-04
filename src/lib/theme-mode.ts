import {
  isDaylightFromWetterAlarm,
  msUntilNextDaylightBoundary,
  type WetterAlarmSunTimes,
} from "@/lib/daylight-schedule";

export type ThemeMode = "light" | "dark" | "sun";

export type { WetterAlarmSunTimes };

const STORAGE_KEY = "pv-dash:theme-mode";

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  light: "Hell",
  dark: "Dunkel",
  sun: "Abhängig vom Sonnenauf- und untergang",
};

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "sun") {
      return stored;
    }
    const legacy = window.localStorage.getItem("theme");
    if (legacy === "dark") return "dark";
    if (legacy === "light") return "light";
  } catch {
    // ignore
  }
  return "light";
}

export function writeThemeMode(mode: ThemeMode): void {
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function resolveColorScheme(
  mode: ThemeMode,
  now: Date,
  sunTimes: WetterAlarmSunTimes | null,
): "light" | "dark" {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  const daylight = isDaylightFromWetterAlarm(now, sunTimes);
  if (daylight == null) return "light";
  return daylight ? "light" : "dark";
}

/** @deprecated Alias für Theme-Controller */
export function msUntilNextSunThemeSwitch(now: Date): number | null {
  return msUntilNextDaylightBoundary(now);
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: ThemeMode = "light";

function refreshSnapshot() {
  snapshot = readThemeMode();
}

export const themeModeStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") refreshSnapshot();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ThemeMode {
    return snapshot;
  },
  getServerSnapshot(): ThemeMode {
    return "light";
  },
  setMode(mode: ThemeMode): void {
    writeThemeMode(mode);
    refreshSnapshot();
    for (const listener of listeners) listener();
  },
};
