/** Gemeinsame Entwicklereinstellungen ohne Standort und ohne Anlagenkoordinaten. */

export const MAX_INFO_BANNER_LENGTH = 2000;

export type SharedDevSettings = {
  hideSimulated: boolean;
  /** Hinweis oberhalb der Wetterkarte. Leer blendet das Banner aus. */
  infoBanner: string;
  /**
   * Leistungsfaktor (PR) für die Open-Meteo-Ertragsprognose.
   * Gilt serverseitig für alle Clients.
   */
  performanceRatio: number;
  configured: boolean;
  updatedAt: string | null;
};

export type DevSettingsUpdate = {
  hideSimulated?: boolean;
  infoBanner?: string;
  performanceRatio?: number;
};

export function normalizeInfoBanner(value: string): string {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > MAX_INFO_BANNER_LENGTH) {
    throw new Error(`Höchstens ${MAX_INFO_BANNER_LENGTH} Zeichen.`);
  }
  return text;
}

/** Liest gespeicherten Text, ohne eine zu lange Datei die Einstellungen verwerfen zu lassen. */
export function readInfoBanner(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, MAX_INFO_BANNER_LENGTH);
}

/** Parst einen PR-Wert; ungültige Werte werden zu null. */
export function readPerformanceRatio(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value <= 1.2 ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1.2 ? parsed : null;
  }
  return null;
}

/** Validiert einen PR-Wert für Updates; wirft bei ungültigen Eingaben. */
export function normalizePerformanceRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1.2) {
    throw new Error("Leistungsfaktor muss grösser als 0 und höchstens 1.2 sein.");
  }
  return value;
}
