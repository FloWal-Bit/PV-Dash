/** Zusatzkarten unter Card 3. Nur sichtbar, wenn sie in den Dev-Einstellungen an sind. */

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
  spotifyEnabled: boolean;
  spotifyUrl: string;
};

export const DEFAULT_EXTRA_CARDS: ExtraCardsSettings = {
  mystromEnabled: false,
  mystromBaseUrl: "",
  mystromKind: "bulb",
  mystromMac: "",
  mystromTokenSet: false,
  spotifyEnabled: false,
  spotifyUrl: "",
};

const SPOTIFY_TYPES = ["track", "album", "playlist", "episode", "show", "artist"] as const;

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

/** Spotify-Link oder -URI → Embed-Adresse. Ungültig → null. */
export function spotifyEmbedSrc(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const uri = /^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]+)$/.exec(trimmed);
  if (uri) {
    return embedSrc(uri[1] ?? "", uri[2] ?? "");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "open.spotify.com" && host !== "play.spotify.com" && host !== "spotify.com") {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const withoutIntl = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
  const withoutEmbed = withoutIntl[0] === "embed" ? withoutIntl.slice(1) : withoutIntl;
  return embedSrc(withoutEmbed[0] ?? "", withoutEmbed[1] ?? "");
}

function embedSrc(type: string, id: string): string | null {
  if (!SPOTIFY_TYPES.includes(type as (typeof SPOTIFY_TYPES)[number])) return null;
  if (!/^[A-Za-z0-9]+$/.test(id)) return null;
  return `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
}

export function normalizeSpotifyUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 500) throw new Error("Spotify-Link ist zu lang.");
  if (!spotifyEmbedSrc(trimmed)) throw new Error("Spotify-Link ist ungültig.");
  return trimmed;
}

export function assertExtraCardsReady(settings: ExtraCardsSettings): void {
  if (settings.mystromEnabled) {
    if (!settings.mystromBaseUrl) throw new Error("myStrom-Adresse fehlt.");
    if (settings.mystromKind === "bulb" && !settings.mystromMac) {
      throw new Error("MAC der Lampe fehlt.");
    }
  }
  if (settings.spotifyEnabled && !spotifyEmbedSrc(settings.spotifyUrl)) {
    throw new Error("Spotify-Link fehlt oder ist ungültig.");
  }
}
