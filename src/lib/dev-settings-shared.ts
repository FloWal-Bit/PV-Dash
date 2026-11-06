/** Gemeinsame Entwicklereinstellungen ohne Standort und ohne Anlagenkoordinaten. */

export const MAX_INFO_BANNER_LENGTH = 2000;

export type InfoBannerSchedule = {
  /** Ab diesem Zeitpunkt anzeigen (ISO UTC). null = sofort. */
  visibleFrom: string | null;
  /** Bis zu diesem Zeitpunkt anzeigen (ISO UTC). null = ohne Ende. */
  visibleUntil: string | null;
};

export type SharedDevSettings = {
  hideSimulated: boolean;
  /** Hinweis oberhalb der Wetterkarte. Leer blendet das Banner aus. */
  infoBanner: string;
  infoBannerVisibleFrom: string | null;
  infoBannerVisibleUntil: string | null;
  /**
   * Leistungsfaktor (PR) für die Open-Meteo-Ertragsprognose.
   * Gilt serverseitig für alle Clients.
   */
  performanceRatio: number;
  configured: boolean;
  updatedAt: string | null;
};

export type DevSettingsUpdate = {
  hideSimulated?: boolean;
  infoBanner?: string;
  infoBannerVisibleFrom?: string | null;
  infoBannerVisibleUntil?: string | null;
  performanceRatio?: number;
};

export function normalizeInfoBanner(value: string): string {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > MAX_INFO_BANNER_LENGTH) {
    throw new Error(`Höchstens ${MAX_INFO_BANNER_LENGTH} Zeichen.`);
  }
  return text;
}

/** Liest gespeicherten Text, ohne eine zu lange Datei die Einstellungen verwerfen zu lassen. */
export function readInfoBanner(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, MAX_INFO_BANNER_LENGTH);
}

/** Akzeptiert ISO-Zeitstempel oder leeren Wert → null. */
export function normalizeInfoBannerInstant(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new Error("Ungültiger Zeitpunkt für das Info-Banner.");
  }
  return new Date(ms).toISOString();
}

export function readInfoBannerInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function normalizeInfoBannerSchedule(
  visibleFrom: string | null,
  visibleUntil: string | null,
): InfoBannerSchedule {
  if (visibleFrom && visibleUntil) {
    const fromMs = Date.parse(visibleFrom);
    const untilMs = Date.parse(visibleUntil);
    if (Number.isFinite(fromMs) && Number.isFinite(untilMs) && untilMs <= fromMs) {
      throw new Error("«Sichtbar bis» muss nach «Sichtbar ab» liegen.");
    }
  }
  return { visibleFrom, visibleUntil };
}

/** true, wenn Text gesetzt ist und das optionale Zeitfenster jetzt gilt. */
export function isInfoBannerActiveNow(
  text: string,
  schedule: InfoBannerSchedule,
  nowMs: number = Date.now(),
): boolean {
  if (!text.trim()) return false;
  if (schedule.visibleFrom) {
    const fromMs = Date.parse(schedule.visibleFrom);
    if (Number.isFinite(fromMs) && nowMs < fromMs) return false;
  }
  if (schedule.visibleUntil) {
    const untilMs = Date.parse(schedule.visibleUntil);
    if (Number.isFinite(untilMs) && nowMs >= untilMs) return false;
  }
  return true;
}

/** datetime-local-Wert (Europe/Zurich) → ISO UTC. */
export function zurichDatetimeLocalToIso(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = asUtc;
  for (let i = 0; i < 3; i++) {
    const offsetMs = zurichOffsetMs(new Date(instant));
    instant = asUtc - offsetMs;
  }
  return new Date(instant).toISOString();
}

/** ISO UTC → datetime-local-Wert in Europe/Zurich. */
export function isoToZurichDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function zurichOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - date.getTime();
}

/** Parst einen PR-Wert; ungültige Werte werden zu null. */
export function readPerformanceRatio(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value <= 1.2 ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1.2 ? parsed : null;
  }
  return null;
}

/** Validiert einen PR-Wert für Updates; wirft bei ungültigen Eingaben. */
export function normalizePerformanceRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1.2) {
    throw new Error("Leistungsfaktor muss grösser als 0 und höchstens 1.2 sein.");
  }
  return value;
}
