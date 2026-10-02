/**
 * Feste forecast.solar-Anfrage (Anlage Kronenmattweg):
 * https://api.forecast.solar/estimate/47.13/7.54/11/0/30.34
 */
export const FORECAST_SOLAR_LATITUDE = 47.13;
export const FORECAST_SOLAR_LONGITUDE = 7.54;

/** Neigung der Module in Grad (forecast.solar: declination). */
export const FORECAST_SOLAR_DECLINATION_DEG = 11;

/** Azimut in Grad (forecast.solar). */
export const FORECAST_SOLAR_AZIMUTH_DEG = 0;

/** Standard-kWp für die forecast.solar-URL. */
export const DEFAULT_FORECAST_SOLAR_PEAK_KWP = 30.34;

export function resolveForecastSolarPeakKwp(): number {
  const raw = process.env.FORECAST_SOLAR_PEAK_KWP?.trim();
  if (raw) {
    const parsed = Number(raw.replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_FORECAST_SOLAR_PEAK_KWP;
}
