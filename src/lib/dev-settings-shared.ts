/** Gemeinsame Entwicklereinstellungen ohne Standort und ohne Anlagenkoordinaten. */

export const MAX_INFO_BANNER_LENGTH = 2000;

export type SharedDevSettings = {
  hideSimulated: boolean;
  /** Hinweis oberhalb der Wetterkarte. Leer blendet das Banner aus. */
  infoBanner: string;
  configured: boolean;
  updatedAt: string | null;
};

export type DevSettingsUpdate = {
  hideSimulated?: boolean;
  infoBanner?: string;
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
