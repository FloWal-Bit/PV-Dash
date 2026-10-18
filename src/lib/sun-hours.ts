/**
 * Sonnenstunden als Sonnenscheindauer am gespeicherten Standort.
 * Open-Meteo liefert die Dauer in Sekunden; die Karte zeigt Stunden.
 */

const API_BASE = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Europe/Zurich";

type DailySunshineResponse = {
  daily?: {
    time?: string[];
    sunshine_duration?: (number | null)[];
  };
};

export function isUsableCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export async function sunshineHoursAt(
  latitude: number,
  longitude: number,
  dateKey: string,
): Promise<number | null> {
  if (!isUsableCoordinate(latitude, longitude)) return null;

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: "sunshine_duration",
    timezone: TIMEZONE,
    forecast_days: "2",
  });
  const response = await fetch(`${API_BASE}?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!response.ok) return null;

  const body = (await response.json()) as DailySunshineResponse;
  const times = body.daily?.time ?? [];
  const durations = body.daily?.sunshine_duration ?? [];
  const index = times.indexOf(dateKey);
  const seconds = index >= 0 ? durations[index] : null;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round((seconds / 3600) * 10) / 10;
}
