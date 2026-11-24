/** Gemeinsame Entwicklereinstellungen ohne Standort und ohne Anlagenkoordinaten. */

import { isDeviceId, MAX_TRACKED_DEVICES } from "@/lib/device-log-shared";
import type { ExtraCardsSettings } from "@/lib/extra-cards-shared";

export const MAX_INFO_BANNER_LENGTH = 2000;

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag. */
export const SURPLUS_WEEKDAYS = [
  { day: 1, short: "Mo", label: "Montag" },
  { day: 2, short: "Di", label: "Dienstag" },
  { day: 3, short: "Mi", label: "Mittwoch" },
  { day: 4, short: "Do", label: "Donnerstag" },
  { day: 5, short: "Fr", label: "Freitag" },
  { day: 6, short: "Sa", label: "Samstag" },
  { day: 7, short: "So", label: "Sonntag" },
] as const;

export const SURPLUS_ALERT_MAX_KW = 100;
/** Nach einer Meldung frühestens wieder so lange, wenn der Überschuss zwischendurch weg war. */
export const SURPLUS_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
/** Hysterese, damit die Meldung nicht bei kleinen Schwankungen um die Schwelle neu startet. */
export const SURPLUS_ALERT_HYSTERESIS_KW = 0.2;
/** Unter diesem Einspeisewert zählt 0 kW nicht als Überschuss (Zählerrauschen). */
const SURPLUS_IDLE_KW = 0.05;

export type SurplusAlertSettings = {
  /** Mindest-Einspeisung in kW. 0 = sobald eingespeist wird. */
  minKw: number;
  /** ISO-Wochentage, 1 = Montag … 7 = Sonntag. Leer = nie. */
  days: number[];
  /** Beginn HH:MM, Europe/Zurich, inklusive. */
  from: string;
  /** Ende HH:MM, Europe/Zurich, inklusive. */
  until: string;
};

export const DEFAULT_SURPLUS_ALERT: SurplusAlertSettings = {
  minKw: 1,
  days: [1, 2, 3, 4, 5, 6, 7],
  from: "08:00",
  until: "20:00",
};

export function copySurplusAlert(alert: SurplusAlertSettings = DEFAULT_SURPLUS_ALERT): SurplusAlertSettings {
  return {
    minKw: alert.minKw,
    days: [...alert.days],
    from: alert.from,
    until: alert.until,
  };
}

export type InfoBannerSchedule = {
  /** Ab diesem Zeitpunkt anzeigen (ISO UTC). null = sofort. */
  visibleFrom: string | null;
  /** Bis zu diesem Zeitpunkt anzeigen (ISO UTC). null = ohne Ende. */
  visibleUntil: string | null;
};

export type SharedDevSettings = ExtraCardsSettings & {
  /** true = Ersatzkurve zeigen, wenn FusionSolar fehlt. Standard aus. */
  showSimulated: boolean;
  /** Hinweis oberhalb der Wetterkarte. Leer blendet das Banner aus. */
  infoBanner: string;
  infoBannerVisibleFrom: string | null;
  infoBannerVisibleUntil: string | null;
  /**
   * Leistungsfaktor (PR) für die Open-Meteo-Ertragsprognose.
   * Gilt serverseitig für alle Clients.
   */
  performanceRatio: number;
  /** Gerätekennungen, die Push-Mitteilungen erhalten dürfen. */
  pushDeviceIds: string[];
  /** Gerätekennungen, die Lampe und Sonos sehen dürfen. Standard leer. */
  cardDeviceIds: string[];
  /** Wann bei Stromüberschuss eine Mitteilung kommt. */
  surplusAlert: SurplusAlertSettings;
  configured: boolean;
  updatedAt: string | null;
};

export type DevSettingsUpdate = {
  showSimulated?: boolean;
  infoBanner?: string;
  infoBannerVisibleFrom?: string | null;
  infoBannerVisibleUntil?: string | null;
  performanceRatio?: number;
  pushDeviceIds?: string[];
  cardDeviceIds?: string[];
  surplusAlert?: SurplusAlertSettings;
  mystromEnabled?: boolean;
  mystromBaseUrl?: string;
  mystromKind?: ExtraCardsSettings["mystromKind"];
  mystromMac?: string;
  /** null löscht den Token. Leer oder weglassen lässt ihn unverändert. */
  mystromToken?: string | null;
  sonosEnabled?: boolean;
  sonosBaseUrl?: string;
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

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Einspeisung in kW. Bezug oder fehlende Messung → 0 bzw. null. */
export function surplusExportKw(gridKw: number | null | undefined): number | null {
  if (typeof gridKw !== "number" || !Number.isFinite(gridKw)) return null;
  return gridKw < 0 ? -gridKw : 0;
}

export function formatSurplusKwInput(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/** HH:MM → Minuten seit Mitternacht. Ungültig → null. */
export function parseClockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function normalizeClock(value: string): string {
  const minutes = parseClockMinutes(value.trim().slice(0, 5));
  if (minutes == null) throw new Error("Ungültige Uhrzeit. Format HH:MM.");
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeSurplusMinKw(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > SURPLUS_ALERT_MAX_KW) {
    throw new Error(`Ertrag muss zwischen 0 und ${SURPLUS_ALERT_MAX_KW} kW liegen.`);
  }
  return Math.round(value * 100) / 100;
}

export function normalizeSurplusDays(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("Wochentage sind ungültig.");
  const days: number[] = [];
  for (const item of value) {
    const day = typeof item === "number" ? item : Number(item);
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new Error("Wochentage sind ungültig.");
    }
    if (!days.includes(day)) days.push(day);
  }
  days.sort((a, b) => a - b);
  return days;
}

export function normalizeSurplusAlert(value: {
  minKw: number;
  days: unknown;
  from: string;
  until: string;
}): SurplusAlertSettings {
  const minKw = normalizeSurplusMinKw(value.minKw);
  const days = normalizeSurplusDays(value.days);
  const from = normalizeClock(value.from);
  const until = normalizeClock(value.until);
  const fromMinutes = parseClockMinutes(from);
  const untilMinutes = parseClockMinutes(until);
  if (fromMinutes == null || untilMinutes == null || untilMinutes <= fromMinutes) {
    throw new Error("«Bis» muss nach «Von» liegen.");
  }
  return { minKw, days, from, until };
}

export function readSurplusAlert(value: unknown): SurplusAlertSettings {
  if (typeof value !== "object" || value === null) return copySurplusAlert();
  const raw = value as Record<string, unknown>;
  const minKw =
    typeof raw.minKw === "number"
      ? raw.minKw
      : typeof raw.minKw === "string"
        ? Number(raw.minKw.trim().replace(",", "."))
        : DEFAULT_SURPLUS_ALERT.minKw;
  try {
    return normalizeSurplusAlert({
      minKw,
      days: "days" in raw ? raw.days : DEFAULT_SURPLUS_ALERT.days,
      from: typeof raw.from === "string" ? raw.from : DEFAULT_SURPLUS_ALERT.from,
      until: typeof raw.until === "string" ? raw.until : DEFAULT_SURPLUS_ALERT.until,
    });
  } catch {
    return copySurplusAlert();
  }
}

export function normalizePushDeviceIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Geräteliste ist ungültig.");
  if (value.length > MAX_TRACKED_DEVICES) {
    throw new Error(`Höchstens ${MAX_TRACKED_DEVICES} Geräte.`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isDeviceId(item)) throw new Error("Ungültige Gerätekennung.");
    const id = item.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function readPushDeviceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  try {
    return normalizePushDeviceIds(value.filter((item) => isDeviceId(item)).slice(0, MAX_TRACKED_DEVICES));
  } catch {
    return [];
  }
}

export function sameSurplusAlert(a: SurplusAlertSettings, b: SurplusAlertSettings): boolean {
  if (a.minKw !== b.minKw || a.from !== b.from || a.until !== b.until) return false;
  if (a.days.length !== b.days.length) return false;
  return a.days.every((day, index) => day === b.days[index]);
}

export function samePushDeviceIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Wochentag und Minute in Europe/Zurich. */
export function zurichWeekdayAndMinutes(date: Date): { weekday: number; minutes: number } | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = WEEKDAY_INDEX[parts.find((part) => part.type === "weekday")?.value ?? ""];
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { weekday, minutes: hour * 60 + minute };
}

/** true, wenn Tag und Uhrzeit (Europe/Zurich) zur Regel passen. */
export function surplusAlertScheduleMatches(settings: SurplusAlertSettings, now: Date): boolean {
  if (settings.days.length === 0) return false;
  const parts = zurichWeekdayAndMinutes(now);
  if (!parts || !settings.days.includes(parts.weekday)) return false;
  const from = parseClockMinutes(settings.from);
  const until = parseClockMinutes(settings.until);
  if (from == null || until == null || until <= from) return false;
  return parts.minutes >= from && parts.minutes <= until;
}

function surplusLevelReached(exportKw: number, minKw: number, wasActive: boolean): boolean {
  if (minKw <= 0) {
    return wasActive ? exportKw >= SURPLUS_IDLE_KW / 2 : exportKw >= SURPLUS_IDLE_KW;
  }
  const release = Math.max(0, minKw - SURPLUS_ALERT_HYSTERESIS_KW);
  return wasActive ? exportKw >= release : exportKw >= minKw;
}

/**
 * Steigende Flanke: eine Meldung, wenn der Überschuss im Fenster beginnt.
 * Bleibt der Zustand aktiv, kommt keine weitere. Nach einer Pause gilt
 * die Abklingzeit, bevor die nächste Phase wieder meldet.
 */
export function evaluateSurplusAlert(input: {
  now: Date;
  gridKw: number | null;
  settings: SurplusAlertSettings;
  wasActive: boolean;
  lastFiredAt: number | null;
  cooldownMs?: number;
}): { active: boolean; fire: boolean; exportKw: number | null } {
  const exportKw = surplusExportKw(input.gridKw);
  // Fehlende Messung ändert die laufende Phase nicht (kein erneutes Auslösen nach einer Lücke).
  if (exportKw == null) return { active: input.wasActive, fire: false, exportKw };
  const scheduled = surplusAlertScheduleMatches(input.settings, input.now);
  const level = surplusLevelReached(exportKw, input.settings.minKw, input.wasActive);
  if (!scheduled || !level) return { active: false, fire: false, exportKw };
  if (input.wasActive) return { active: true, fire: false, exportKw };
  const cooldown = input.cooldownMs ?? SURPLUS_ALERT_COOLDOWN_MS;
  const cooled = input.lastFiredAt == null || input.now.getTime() - input.lastFiredAt >= cooldown;
  if (!cooled) return { active: false, fire: false, exportKw };
  return { active: true, fire: true, exportKw };
}
