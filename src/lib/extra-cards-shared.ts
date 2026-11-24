/** Zusatzkarten unter dem Verlauf. Sichtbar, sobald der Schalter in den Dev-Einstellungen an ist. */

export type MystromKind = "bulb" | "switch";

export type ExtraCardsSettings = {
  mystromEnabled: boolean;
  /** Origin, z. B. http://192.168.1.50 */
  mystromBaseUrl: string;
  mystromKind: MystromKind;
  /** MAC ohne Trennzeichen. Nur für die Lampe (Bulb). */
  mystromMac: string;
  /** true, wenn serverseitig ein API-Token liegt. Der Token selbst geht nicht an den Client. */
  mystromTokenSet: boolean;
  sonosEnabled: boolean;
  /** Origin des Lautsprechers, z. B. http://192.168.1.40:1400 */
  sonosBaseUrl: string;
};

export const DEFAULT_EXTRA_CARDS: ExtraCardsSettings = {
  mystromEnabled: false,
  mystromBaseUrl: "",
  mystromKind: "bulb",
  mystromMac: "",
  mystromTokenSet: false,
  sonosEnabled: false,
  sonosBaseUrl: "",
};

const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata.google.com"]);

export function readMystromKind(value: unknown): MystromKind {
  return value === "switch" ? "switch" : "bulb";
}

export function normalizeMystromKind(value: unknown): MystromKind {
  if (value === "bulb" || value === "switch") return value;
  throw new Error("Gerätetyp ist ungültig.");
}

/** Leere Eingabe bleibt leer. Sonst nur http(s)-Origin, ohne Pfad und ohne Zugangsdaten. */
export function normalizeMystromBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 200) throw new Error("myStrom-Adresse ist zu lang.");
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
  } catch {
    throw new Error("myStrom-Adresse ist ungültig.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("myStrom-Adresse muss http oder https sein.");
  }
  if (url.username || url.password) {
    throw new Error("myStrom-Adresse darf kein Passwort enthalten.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host === "169.254.169.254") {
    throw new Error("Diese Adresse ist nicht erlaubt.");
  }
  return url.origin;
}

/** MAC der myStrom-Lampe, 12 Zeichen ohne Doppelpunkte. Leer ist erlaubt. */
export function normalizeMystromMac(value: string): string {
  const mac = value.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!mac) return "";
  if (!/^[A-Z0-9]{12}$/.test(mac)) {
    throw new Error("MAC der Lampe muss 12 Zeichen haben, ohne Doppelpunkte.");
  }
  return mac;
}

export function normalizeMystromToken(value: string): string {
  const token = value.trim();
  if (token.length > 200) throw new Error("myStrom-Token ist zu lang.");
  return token;
}

/** Leere Eingabe bleibt leer. Sonst http-Origin des Lautsprechers auf Port 1400. */
export function normalizeSonosBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 200) throw new Error("Sonos-Adresse ist zu lang.");
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
  } catch {
    throw new Error("Sonos-Adresse ist ungültig.");
  }
  if (url.protocol !== "http:") {
    throw new Error("Sonos-Adresse muss http sein.");
  }
  if (url.username || url.password) {
    throw new Error("Sonos-Adresse darf kein Passwort enthalten.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host === "169.254.169.254") {
    throw new Error("Diese Adresse ist nicht erlaubt.");
  }
  const explicitPort = /:(\d+)(?:[/?#]|$)/.exec(trimmed)?.[1];
  if (explicitPort && explicitPort !== "1400") {
    throw new Error("Sonos-Adresse muss Port 1400 verwenden.");
  }
  url.port = "1400";
  return url.origin;
}
