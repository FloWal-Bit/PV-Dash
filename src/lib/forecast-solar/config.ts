/** Neigung der Module in Grad (forecast.solar: declination). */
export const FORECAST_SOLAR_DECLINATION_DEG = 11;

/** Azimut in Grad (forecast.solar: 180 = Süden). */
export const FORECAST_SOLAR_AZIMUTH_DEG = 180;

/** Standard-kWp für die forecast.solar-URL (Anlage Kronenmattweg). */
export const DEFAULT_FORECAST_SOLAR_PEAK_KWP = 30.34;

export function resolveForecastSolarPeakKwp(): number {
  const raw = process.env.FORECAST_SOLAR_PEAK_KWP?.trim();
  if (raw) {
    const parsed = Number(raw.replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_FORECAST_SOLAR_PEAK_KWP;
}
