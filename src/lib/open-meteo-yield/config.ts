/**
 * Tagesertrags-Prognose aus Open-Meteo global_tilted_irradiance (GTI).
 * Anlage Kronenmattweg — gleiche Geometrie wie forecast.solar.
 */
import { resolveForecastSolarPeakKwp } from "@/lib/forecast-solar/config";

export const OPEN_METEO_LATITUDE = 47.13;
export const OPEN_METEO_LONGITUDE = 7.54;
export const OPEN_METEO_TILT_DEG = 11;
export const OPEN_METEO_AZIMUTH_DEG = 0;
export const OPEN_METEO_TIMEZONE = "Europe/Zurich";

/** Kalibrierung Sep/Okt 2026 (GTI × kWp × PR). */
export const DEFAULT_OPEN_METEO_PERFORMANCE_RATIO = 0.78;

export function resolveOpenMeteoPeakKwp(): number {
  return resolveForecastSolarPeakKwp();
}

export function resolveOpenMeteoPerformanceRatio(): number {
  const raw = process.env.OPEN_METEO_YIELD_PR?.trim();
  if (raw) {
    const parsed = Number(raw.replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1.2) return parsed;
  }
  return DEFAULT_OPEN_METEO_PERFORMANCE_RATIO;
}
