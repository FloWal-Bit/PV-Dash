/** Geplante Server-Nachtpause Europe/Zurich: 23:30–06:00. */
export const SERVER_PAUSE_START_MINUTES = 23 * 60 + 30;
export const SERVER_PAUSE_END_MINUTES = 6 * 60;

const ZURICH = "Europe/Zurich";

function zurichMinutesSinceMidnight(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZURICH,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** Kalendertag Europe/Zurich als YYYY-MM-DD. */
export function zurichDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs).toLocaleDateString("en-CA", { timeZone: ZURICH });
}

/**
 * Millisekunden bis zur nächsten Zurich-Mitternacht.
 * Mindestens 1 s, damit ein gesetzter Timer nicht sofort erneut feuert.
 */
export function msUntilNextZurichMidnight(nowMs: number = Date.now()): number {
  const minutes = zurichMinutesSinceMidnight(nowMs);
  const minutesToMidnight = 24 * 60 - minutes;
  return Math.max(1_000, minutesToMidnight * 60_000);
}

/** true in der geplanten Server-Nachtpause (23:30–06:00 Europe/Zurich). */
export function isScheduledServerPause(nowMs: number = Date.now()): boolean {
  const minutes = zurichMinutesSinceMidnight(nowMs);
  return minutes >= SERVER_PAUSE_START_MINUTES || minutes < SERVER_PAUSE_END_MINUTES;
}

/**
 * Millisekunden bis zum Ende der aktuellen Pause (nächstes 06:00 Zurich).
 * Ausserhalb der Pause: 0.
 */
export function msUntilScheduledPauseEnd(nowMs: number = Date.now()): number {
  if (!isScheduledServerPause(nowMs)) return 0;
  const minutes = zurichMinutesSinceMidnight(nowMs);
  const minutesToEnd =
    minutes >= SERVER_PAUSE_START_MINUTES
      ? 24 * 60 - minutes + SERVER_PAUSE_END_MINUTES
      : SERVER_PAUSE_END_MINUTES - minutes;
  return minutesToEnd * 60_000;
}

/**
 * Millisekunden bis zum nächsten Pause-Beginn (23:30 Zurich).
 * Innerhalb der Pause: 0.
 */
export function msUntilScheduledPauseStart(nowMs: number = Date.now()): number {
  if (isScheduledServerPause(nowMs)) return 0;
  const minutes = zurichMinutesSinceMidnight(nowMs);
  // Ausserhalb der Pause sind wir zwischen 06:00 und 23:30.
  return (SERVER_PAUSE_START_MINUTES - minutes) * 60_000;
}
