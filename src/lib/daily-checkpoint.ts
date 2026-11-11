/**
 * Wetter-Alarm-Abrufmarken (Europe/Zurich).
 * 06:00 statt 05:00: Node ist 23:30–06:00 aus — 05:00 würde ins Leere laufen.
 * 23:00: letzter Refresh vor der Nachtpause.
 */
export const WEATHER_REFRESH_HOURS = [6, 12, 18, 23] as const;
export const APP_TIME_ZONE = "Europe/Zurich";

/** @deprecated Gleichmässiges 6‑h-Raster entfällt; Marken siehe WEATHER_REFRESH_HOURS. */
export const WEATHER_REFRESH_INTERVAL_HOURS = 6;

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
    utc += deltaMinutes * 60_000;
  }
  return utc;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const nextUtc = Date.UTC(year, month - 1, day) + deltaDays * 86_400_000;
  const next = datePartsInZone(new Date(nextUtc), APP_TIME_ZONE);
  return { year: next.year, month: next.month, day: next.day };
}

/** Letzte Abrufmarke ≤ now (Ortszeit Zurich). */
export function lastDailyCheckpointMs(now: Date = new Date()): number {
  const z = datePartsInZone(now, APP_TIME_ZONE);
  const minutes = z.hour * 60 + z.minute;
  let slotHour: number | null = null;
  for (let i = WEATHER_REFRESH_HOURS.length - 1; i >= 0; i--) {
    const hour = WEATHER_REFRESH_HOURS[i]!;
    if (minutes >= hour * 60) {
      slotHour = hour;
      break;
    }
  }
  if (slotHour != null) {
    return zonedDateTimeToUtcMs(z.year, z.month, z.day, slotHour, 0, APP_TIME_ZONE);
  }
  // Vor der ersten Marke heute → letzte Marke gestern (23:00).
  const prev = addCalendarDays(z.year, z.month, z.day, -1);
  const lastHour = WEATHER_REFRESH_HOURS[WEATHER_REFRESH_HOURS.length - 1]!;
  return zonedDateTimeToUtcMs(prev.year, prev.month, prev.day, lastHour, 0, APP_TIME_ZONE);
}

/** Millisekunden bis zur nächsten Abrufmarke (mind. 1 Minute). */
export function msUntilNextDailyCheckpoint(now: Date = new Date()): number {
  const z = datePartsInZone(now, APP_TIME_ZONE);
  const minutes = z.hour * 60 + z.minute;

  for (const hour of WEATHER_REFRESH_HOURS) {
    if (minutes < hour * 60) {
      const nextMs = zonedDateTimeToUtcMs(z.year, z.month, z.day, hour, 0, APP_TIME_ZONE);
      return Math.max(60_000, nextMs - now.getTime());
    }
  }

  const nextDay = addCalendarDays(z.year, z.month, z.day, 1);
  const firstHour = WEATHER_REFRESH_HOURS[0]!;
  const nextMs = zonedDateTimeToUtcMs(
    nextDay.year,
    nextDay.month,
    nextDay.day,
    firstHour,
    0,
    APP_TIME_ZONE,
  );
  return Math.max(60_000, nextMs - now.getTime());
}
