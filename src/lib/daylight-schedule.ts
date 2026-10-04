import { weatherDateKey, weatherStore } from "@/lib/weather-store";

export type WetterAlarmSunTimes = {
  sunriseAt: string;
  sunsetAt: string;
};

const BOUNDARY_FALLBACK_MS = 15 * 60 * 1000;

export function getTodaySunTimesFromCache(): WetterAlarmSunTimes | null {
  const today = weatherStore.getWeatherForDate(weatherDateKey());
  if (!today?.sunriseAt || !today.sunsetAt) return null;
  return { sunriseAt: today.sunriseAt, sunsetAt: today.sunsetAt };
}

/** Hell zwischen Sonnenaufgang (inkl.) und Sonnenuntergang (exkl.), Zeiten von Wetter-Alarm. */
export function isDaylightFromWetterAlarm(
  now: Date,
  sunTimes: WetterAlarmSunTimes | null,
): boolean | null {
  if (!sunTimes) return null;
  const sunrise = new Date(sunTimes.sunriseAt);
  const sunset = new Date(sunTimes.sunsetAt);
  if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) {
    return null;
  }
  const t = now.getTime();
  return t >= sunrise.getTime() && t < sunset.getTime();
}

/** Millisekunden bis zum nächsten Sonnenauf- oder -untergang (für Timer). */
export function msUntilNextDaylightBoundary(now: Date = new Date()): number | null {
  const todayKey = weatherDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = weatherDateKey(tomorrow);

  const today = weatherStore.getWeatherForDate(todayKey);
  if (!today?.sunriseAt || !today.sunsetAt) return null;

  const t = now.getTime();
  const sunrise = new Date(today.sunriseAt).getTime();
  const sunset = new Date(today.sunsetAt).getTime();
  if (t < sunrise) return sunrise - t;
  if (t < sunset) return sunset - t;

  const tomorrowDay = weatherStore.getWeatherForDate(tomorrowKey);
  if (tomorrowDay?.sunriseAt) {
    const nextSunrise = new Date(tomorrowDay.sunriseAt).getTime();
    if (nextSunrise > t) return nextSunrise - t;
  }

  return BOUNDARY_FALLBACK_MS;
}
