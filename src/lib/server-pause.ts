/**
 * Tägliche Server-Pause (Europe/Zurich), z. B. Stopp um 00:00, Start um 06:00.
 * Die Zeiten werden lokal gespiegelt, damit die Offline-App sie ohne Server kennt.
 */

export type ServerPauseSettings = {
  enabled: boolean;
  /** HH:mm — Server wird typischerweise gestoppt. */
  stopAt: string;
  /** HH:mm — aktualisierte Daten wieder erwartet. */
  resumeAt: string;
};

export const DEFAULT_SERVER_PAUSE: ServerPauseSettings = {
  enabled: false,
  stopAt: "00:00",
  resumeAt: "06:00",
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeDayTime(value: string, label: string): string {
  const trimmed = value.trim();
  if (!TIME_RE.test(trimmed)) {
    throw new Error(`${label} muss als HH:mm angegeben werden.`);
  }
  return trimmed;
}

export function readDayTime(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return TIME_RE.test(trimmed) ? trimmed : fallback;
}

export function minutesSinceMidnightZurich(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** true, wenn «jetzt» im täglichen Pause-Fenster liegt (kann über Mitternacht gehen). */
export function isWithinServerPauseWindow(
  settings: ServerPauseSettings,
  now: Date = new Date(),
): boolean {
  if (!settings.enabled) return false;
  const stop = parseMinutes(settings.stopAt);
  const resume = parseMinutes(settings.resumeAt);
  if (stop === resume) return false;
  const nowMin = minutesSinceMidnightZurich(now);
  if (stop < resume) {
    return nowMin >= stop && nowMin < resume;
  }
  return nowMin >= stop || nowMin < resume;
}

export function formatServerPauseMessage(
  settings: ServerPauseSettings,
  opts: { unreachable: boolean; lastFetchedAt: number | null },
): string | null {
  if (!opts.unreachable) return null;

  const resume = settings.resumeAt;
  const stop = settings.stopAt;
  const last =
    opts.lastFetchedAt != null
      ? new Date(opts.lastFetchedAt).toLocaleString("de-CH", {
          timeZone: "Europe/Zurich",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const cached = last ? ` Letzter Stand: ${last}.` : "";

  if (settings.enabled) {
    const inWindow = isWithinServerPauseWindow(settings);
    const when = inWindow
      ? `Aktualisierte Daten voraussichtlich ab ${resume} (Europe/Zurich).`
      : `Geplante Pause ${stop}–${resume} (Europe/Zurich). Aktualisierte Daten wieder, sobald der Server läuft.`;
    return `Server nicht erreichbar — es werden gespeicherte Werte angezeigt. ${when}${cached}`;
  }

  return `Server nicht erreichbar — es werden gespeicherte Werte angezeigt. Aktualisierte Daten wieder, sobald der Server läuft.${cached}`;
}
