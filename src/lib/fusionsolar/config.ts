/**
 * Konfiguration für die Huawei FusionSolar Northbound API.
 *
 * Alle Werte kommen ausschließlich aus Umgebungsvariablen (Server-Secrets) –
 * sie werden nie an den Client gesendet und nicht im Repo gespeichert. Siehe
 * README.md, Abschnitt "FusionSolar-Anbindung", für die Einrichtung.
 */

export type FusionSolarConfig = {
  /** z. B. https://region01eu5.fusionsolar.huawei.com (ohne Pfad, ohne Slash am Ende) */
  baseUrl: string;
  /** Northbound-API-Benutzername (NICHT das normale Portal-Login) */
  username: string;
  /** Northbound-API-Passwort, von Huawei "systemCode" genannt */
  systemCode: string;
  /** Optional: feste Plant-ID (plantCode). Wenn leer, wird die erste Anlage automatisch ermittelt. */
  stationCode?: string;
};

export function getFusionSolarConfig(): FusionSolarConfig | null {
  const baseUrl = process.env.FUSIONSOLAR_BASE_URL?.trim().replace(/\/+$/, "");
  const username = process.env.FUSIONSOLAR_USERNAME?.trim();
  const systemCode = process.env.FUSIONSOLAR_SYSTEM_CODE?.trim();
  const stationCode = process.env.FUSIONSOLAR_STATION_CODE?.trim();

  if (!baseUrl || !username || !systemCode) {
    return null;
  }

  return { baseUrl, username, systemCode, stationCode: stationCode || undefined };
}

export function isFusionSolarConfigured(): boolean {
  return getFusionSolarConfig() !== null;
}
