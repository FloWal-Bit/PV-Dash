/** Wetter-Alarm: alle 6 Stunden, an den Marken 00:00, 06:00, 12:00 und 18:00. */
export const WEATHER_REFRESH_INTERVAL_HOURS = 6;
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

/** UTC-Zeitstempel der letzten 6-Stunden-Marke (Ortszeit), die ≤ `now` ist. */
export function lastDailyCheckpointMs(now: Date = new Date()): number {
  const z = datePartsInZone(now, APP_TIME_ZONE);
  const slotHour =
    Math.floor(z.hour / WEATHER_REFRESH_INTERVAL_HOURS) * WEATHER_REFRESH_INTERVAL_HOURS;
  return zonedDateTimeToUtcMs(z.year, z.month, z.day, slotHour, 0, APP_TIME_ZONE);
}

export function msUntilNextDailyCheckpoint(now: Date = new Date()): number {
  const z = datePartsInZone(now, APP_TIME_ZONE);
  let slotHour =
    (Math.floor(z.hour / WEATHER_REFRESH_INTERVAL_HOURS) + 1) * WEATHER_REFRESH_INTERVAL_HOURS;
  let year = z.year;
  let month = z.month;
  let day = z.day;

  if (slotHour >= 24) {
    slotHour = 0;
    const nextUtc = Date.UTC(year, month - 1, day) + 86_400_000;
    const next = datePartsInZone(new Date(nextUtc), APP_TIME_ZONE);
    year = next.year;
    month = next.month;
    day = next.day;
  }

  const nextMs = zonedDateTimeToUtcMs(year, month, day, slotHour, 0, APP_TIME_ZONE);
  return Math.max(60_000, nextMs - now.getTime());
}
