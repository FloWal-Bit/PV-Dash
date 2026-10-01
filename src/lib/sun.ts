/**
 * Sonnenauf-/-untergang und prognostizierte Sonnenstunden für einen
 * Standort und Tag. Die Zeiten sind astronomisch exakt (via `suncalc`),
 * die "Sonnenstunden" sind eine Prognose: Tageslänge multipliziert mit
 * einem Bewölkungsfaktor, damit der Wert nicht einfach die pure
 * Tageslänge wiederholt, sondern eine plausible Wettererwartung abbildet.
 *
 * Der Standard-Standort ist Bätterkinden (CH); Nutzer können ihn in den
 * Einstellungen anpassen (siehe site-location.ts). Deployments können
 * NEXT_PUBLIC_SITE_LATITUDE/LONGITUDE setzen.
 */
import * as SunCalc from "suncalc";
import { DEFAULT_SITE_LOCATION, getDeployedSiteLocation } from "@/lib/site-location";

export type SunInfo = {
  sunrise: Date;
  sunset: Date;
  /** Astronomische Tageslänge (Sonnenaufgang bis -untergang) in Stunden. */
  daylightHours: number;
  /** Prognostizierte, tatsächlich sonnige Stunden (Tageslänge × Wettererwartung). */
  forecastedSunHours: number;
};

export function getSiteLocation(): { latitude: number; longitude: number } {
  const deployed = getDeployedSiteLocation();
  return { latitude: deployed.latitude, longitude: deployed.longitude };
}

export { DEFAULT_SITE_LOCATION };

function seededFraction(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function getSunInfo(
  date: Date = new Date(),
  location: { latitude: number; longitude: number } = getSiteLocation(),
): SunInfo {
  const times = SunCalc.getTimes(date, location.latitude, location.longitude);
  // In Polarregionen kann die Sonne an manchen Tagen gar nicht auf- oder
  // untergehen (Polartag/-nacht); suncalc gibt dann `null` zurück. Wir
  // fallen in diesem Fall auf Tagesanfang/-ende zurück, statt abzustürzen.
  const sunrise = times.sunrise ?? startOfDay(date);
  const sunset = times.sunset ?? endOfDay(date);
  const daylightHours = (sunset.getTime() - sunrise.getTime()) / (1000 * 60 * 60);

  // Deterministisch pro Kalendertag, damit die Prognose beim Neuladen
  // stabil bleibt statt bei jedem Aufruf zu "flackern".
  const daySeed = date.getFullYear() * 400 + date.getMonth() * 31 + date.getDate();
  const sunshineFactor = 0.55 + seededFraction(daySeed * 3.7) * 0.4; // 0.55–0.95

  return {
    sunrise,
    sunset,
    daylightHours: round1(daylightHours),
    forecastedSunHours: round1(daylightHours * sunshineFactor),
  };
}

// Realer Ertrag liegt aufgrund von Temperatur-, Verkabelungs- und
// Wechselrichterverlusten üblicherweise bei ca. 75–85 % des theoretischen
// Werts aus Anlagenleistung × Sonnenstunden ("Performance Ratio").
const PERFORMANCE_RATIO = 0.8;

/**
 * Schätzt den zu erwartenden Tagesertrag (kWh) aus der Anlagenleistung
 * (kWp) und den prognostizierten Sonnenstunden des Tages.
 */
export function estimateForecastedYieldKwh(systemPeakKwp: number, sunInfo: SunInfo): number {
  return round1(systemPeakKwp * sunInfo.forecastedSunHours * PERFORMANCE_RATIO);
}
