/** Geräte, die PV Dash geöffnet haben. Kein Standort, keine IP, kein User-Agent. */

export const MAX_DEVICE_LABEL_LENGTH = 80;
export const MAX_TRACKED_DEVICES = 100;

/** UUID, wie sie `crypto.randomUUID()` erzeugt. */
export const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeviceVisit = {
  id: string;
  /** Grobes Gerät, z. B. «iPhone · Safari» oder «Windows · App». */
  label: string;
  firstSeen: string;
  lastSeen: string;
  hits: number;
};

export type DeviceLogSummary = {
  count: number;
  /** Geräte, deren letzter Aufruf heute in Europe/Zurich liegt. */
  todayCount: number;
  devices: DeviceVisit[];
};

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
}

export function normalizeDeviceLabel(value: unknown): string {
  if (typeof value !== "string") return "Unbekanntes Gerät";
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DEVICE_LABEL_LENGTH);
  return text.length > 0 ? text : "Unbekanntes Gerät";
}
