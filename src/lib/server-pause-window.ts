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
