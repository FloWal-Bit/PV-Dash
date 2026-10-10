import {
  isDaylightFromWetterAlarm,
  msUntilNextDaylightBoundary,
  type WetterAlarmSunTimes,
} from "@/lib/daylight-schedule";

export type ThemeMode = "light" | "dark" | "sun";

export type { WetterAlarmSunTimes };

const STORAGE_KEY = "pv-dash:theme-mode";
const DARK_VARIANT_KEY = "pv-dash:dark-variant";

/** Abgesetzt: Karten heller als der Hintergrund. Flach: Karten liegen näher am Hintergrund. */
export type DarkVariant = "raised" | "flat";

export const DARK_VARIANT_LABELS: Record<DarkVariant, string> = {
  raised: "Abgesetzt",
  flat: "Flach",
};

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

const LIGHT_THEME_COLOR = "#fbf9f5";
const DARK_THEME_COLOR = "#171d2c";
const DARK_FLAT_THEME_COLOR = "#12151c";

export function readDarkVariant(): DarkVariant {
  if (typeof window === "undefined") return "raised";
  try {
    return window.localStorage.getItem(DARK_VARIANT_KEY) === "flat" ? "flat" : "raised";
  } catch {
    return "raised";
  }
}

/**
 * Setzt Klasse, color-scheme und theme-color direkt am Dokument.
 * next-themes allein reicht auf Mobilgeräten nicht: Chrome und Safari
 * dunkeln eine helle Seite ab, solange das System auf Dunkel steht und
 * die Seite kein eigenes color-scheme meldet.
 */
export function applyDocumentColorScheme(scheme: "light" | "dark"): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.remove("light", "dark", "dark-flat");
  root.classList.add(scheme);
  if (scheme === "dark" && readDarkVariant() === "flat") {
    root.classList.add("dark-flat");
  }
  // "only" untersagt Chrome/Vivaldi, eine helle Seite bei dunklem System
  // noch einmal abzudunkeln. Die CSSOM-Eigenschaft colorScheme kennt "only" nicht.
  root.style.setProperty("color-scheme", scheme === "dark" ? "only dark" : "only light");
  try {
    window.localStorage.setItem("pv-dash:color-scheme", scheme);
    window.localStorage.setItem("theme", scheme);
  } catch {
    // ignore
  }

  const themeColor =
    scheme === "dark"
      ? readDarkVariant() === "flat"
        ? DARK_FLAT_THEME_COLOR
        : DARK_THEME_COLOR
      : LIGHT_THEME_COLOR;
  const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const primary = themeMetas[0] ?? document.createElement("meta");
  primary.setAttribute("name", "theme-color");
  primary.setAttribute("content", themeColor);
  primary.removeAttribute("media");
  if (!primary.parentElement) document.head.appendChild(primary);
  for (const extra of themeMetas.slice(1)) extra.remove();

  let colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
  if (!colorSchemeMeta) {
    colorSchemeMeta = document.createElement("meta");
    colorSchemeMeta.setAttribute("name", "color-scheme");
    document.head.appendChild(colorSchemeMeta);
  }
  colorSchemeMeta.setAttribute("content", scheme === "dark" ? "only dark" : "only light");
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
const darkVariantListeners = new Set<Listener>();
let snapshot: ThemeMode = "light";
let darkVariantSnapshot: DarkVariant = "raised";

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

function refreshDarkVariantSnapshot() {
  darkVariantSnapshot = readDarkVariant();
}

export const darkVariantStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") refreshDarkVariantSnapshot();
    darkVariantListeners.add(listener);
    return () => darkVariantListeners.delete(listener);
  },
  getSnapshot(): DarkVariant {
    return darkVariantSnapshot;
  },
  getServerSnapshot(): DarkVariant {
    return "raised";
  },
  setVariant(variant: DarkVariant): void {
    try {
      window.localStorage.setItem(DARK_VARIANT_KEY, variant);
    } catch {
      // ignore
    }
    refreshDarkVariantSnapshot();
    for (const listener of darkVariantListeners) listener();
  },
};
