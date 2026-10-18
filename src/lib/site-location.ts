/**
 * Standort für Wetter, Sonnenzeiten und Sonnenstunden.
 * Gespeicherte Angaben liegen auf dem Server und gelten für alle Geräte.
 */

export type SiteLocation = {
  /** Schweizer PLZ (vierstellig), steuert die Auswahl im PLZ-Verzeichnis. */
  plz: string;
  /** Ortsname für Wetter-Alarm (aus PLZ-Verzeichnis). */
  name: string;
  latitude: number;
  longitude: number;
};

/** Gemeinde Bätterkinden (Kanton Bern), Standort der PV-Anlage. */
export const DEFAULT_SITE_LOCATION: SiteLocation = {
  plz: "3315",
  name: "Bätterkinden",
  latitude: 47.135,
  longitude: 7.532,
};

const STORAGE_KEY = "pv-dash:site-location";

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function readEnvLocation(): SiteLocation | null {
  const latRaw = process.env.NEXT_PUBLIC_SITE_LATITUDE?.trim();
  const lonRaw = process.env.NEXT_PUBLIC_SITE_LONGITUDE?.trim();
  if (!latRaw || !lonRaw) return null;

  const latitude = Number(latRaw);
  const longitude = Number(lonRaw);
  if (!isValidCoordinate(latitude, longitude)) return null;

  return { plz: "", name: "Umgebungsvariable", latitude, longitude };
}

/** Serverseitiger Fallback ohne localStorage (Env → Bätterkinden). */
export function getDeployedSiteLocation(): SiteLocation {
  return readEnvLocation() ?? DEFAULT_SITE_LOCATION;
}

function readStoredLocation(): SiteLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    const name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : "Eigener Standort";
    const plz =
      typeof v.plz === "string" && /^\d{4}$/.test(v.plz.trim()) ? v.plz.trim() : "";
    const latitude = Number(v.latitude);
    const longitude = Number(v.longitude);
    if (!isValidCoordinate(latitude, longitude)) return null;
    return { plz, name, latitude, longitude };
  } catch {
    return null;
  }
}

export type SiteLocationState = {
  location: SiteLocation;
  /** true, wenn der Nutzer einen eigenen Standort in localStorage gespeichert hat. */
  isCustom: boolean;
};

function computeState(): SiteLocationState {
  const stored = readStoredLocation();
  return {
    location: stored ?? getDeployedSiteLocation(),
    isCustom: stored != null,
  };
}

const SERVER_STATE: SiteLocationState = {
  location: getDeployedSiteLocation(),
  isCustom: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let state: SiteLocationState = SERVER_STATE;

function emit() {
  for (const listener of listeners) listener();
}

function refreshState() {
  state = computeState();
  emit();
}

export const siteLocationStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") refreshState();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): SiteLocationState {
    return state;
  },
  getServerSnapshot(): SiteLocationState {
    return SERVER_STATE;
  },
  save(location: SiteLocation): Promise<SiteLocationState> {
    if (!isValidCoordinate(location.latitude, location.longitude)) {
      return Promise.resolve(state);
    }
    const normalized: SiteLocation = {
      plz: /^\d{4}$/.test(location.plz.trim()) ? location.plz.trim() : "",
      name: location.name.trim() || "Eigener Standort",
      latitude: Math.round(location.latitude * 1_000_000) / 1_000_000,
      longitude: Math.round(location.longitude * 1_000_000) / 1_000_000,
    };
    return import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
      putDevSettings({ siteLocation: normalized }).then(() => state),
    );
  },
  applyRemote(location: SiteLocation, isCustom: boolean): void {
    if (!isValidCoordinate(location.latitude, location.longitude)) return;
    const normalized: SiteLocation = {
      plz: /^\d{4}$/.test(location.plz.trim()) ? location.plz.trim() : "",
      name: location.name.trim() || "Eigener Standort",
      latitude: Math.round(location.latitude * 1_000_000) / 1_000_000,
      longitude: Math.round(location.longitude * 1_000_000) / 1_000_000,
    };
    if (typeof window !== "undefined") {
      if (isCustom) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      else window.localStorage.removeItem(STORAGE_KEY);
    }
    state = { location: isCustom ? normalized : normalized, isCustom };
    emit();
  },
  resetToDefault(): SiteLocationState {
    window.localStorage.removeItem(STORAGE_KEY);
    refreshState();
    return state;
  },
};

export function parseCoordinateInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
