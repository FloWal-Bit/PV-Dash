/** Täglicher Abruf-Zeitpunkt für langsam ändernde Daten (Wetter-Alarm). */
export const DAILY_REFRESH_HOUR = 8;
export const APP_TIME_ZONE = "Europe/Zurich";

function datePartsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function zonedDateTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  let utc = Date.UTC(year, month - 1, day, hour - 1, minute, 0);
  for (let i = 0; i < 96; i++) {
    const p = datePartsInZone(new Date(utc), timeZone);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute
    ) {
      return utc;
    }
    const deltaMinutes =
      (year - p.year) * 525_600 +
      (month - p.month) * 43_200 +
      (day - p.day) * 1_440 +
      (hour - p.hour) * 60 +
      (minute - p.minute);
    utc += deltaMinutes * 60 * 1000;
  }
  return utc;
}

/** UTC-Zeitstempel der letzten 08:00-Uhr-Marke (Ortszeit), die ≤ `now` ist. */
export function lastDailyCheckpointMs(now: Date = new Date()): number {
  const z = datePartsInZone(now, APP_TIME_ZONE);
  let year = z.year;
  let month = z.month;
  let day = z.day;

  const beforeCheckpoint = z.hour < DAILY_REFRESH_HOUR;

  if (beforeCheckpoint) {
    const prevUtc = Date.UTC(year, month - 1, day) - 86_400_000;
    const prev = datePartsInZone(new Date(prevUtc), APP_TIME_ZONE);
    year = prev.year;
    month = prev.month;
    day = prev.day;
  }

  return zonedDateTimeToUtcMs(year, month, day, DAILY_REFRESH_HOUR, 0, APP_TIME_ZONE);
}

export function msUntilNextDailyCheckpoint(now: Date = new Date()): number {
  const last = lastDailyCheckpointMs(now);
  const next = last + 24 * 60 * 60 * 1000;
  return Math.max(60_000, next - now.getTime());
}
