/**
 * Gemeinsame Entwicklereinstellungen ohne Ort und ohne Anlagenkoordinaten.
 * Liegt in .data/dev-settings.json. Standort bleibt auf dem Gerät.
 * Der Leistungsfaktor (PR) gilt serverseitig für die Ertragsprognose aller Clients.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  readInfoBanner,
  readInfoBannerInstant,
  readPerformanceRatio,
  readPushDeviceIds,
  readSurplusAlert,
  normalizeInfoBanner,
  normalizeInfoBannerInstant,
  normalizeInfoBannerSchedule,
  normalizePerformanceRatio,
  normalizePushDeviceIds,
  normalizeSurplusAlert,
  copySurplusAlert,
  type DevSettingsUpdate,
  type SharedDevSettings,
  type SurplusAlertSettings,
} from "@/lib/dev-settings-shared";
import {
  normalizeMystromBaseUrl,
  normalizeMystromKind,
  normalizeMystromMac,
  normalizeMystromToken,
  normalizeSonosBaseUrl,
  readMystromKind,
  type ExtraCardsSettings,
  type MystromKind,
} from "@/lib/extra-cards-shared";
import { isDeviceId, DEVICE_ID_HEADER } from "@/lib/device-log-shared";
import { resolveOpenMeteoPerformanceRatio } from "@/lib/open-meteo-yield/config";

export type { DevSettingsUpdate, SharedDevSettings };

type PersistedDevSettings = {
  updatedAt: string;
  /** null = noch nicht gesetzt → aus. */
  showSimulated: boolean | null;
  infoBanner: string;
  infoBannerVisibleFrom: string | null;
  infoBannerVisibleUntil: string | null;
  /** null = noch nicht gesetzt → Env/Default. */
  performanceRatio: number | null;
  pushDeviceIds: string[];
  cardDeviceIds: string[];
  surplusAlert: SurplusAlertSettings;
  mystromEnabled: boolean;
  mystromBaseUrl: string;
  mystromKind: MystromKind;
  mystromMac: string;
  mystromToken: string;
  sonosEnabled: boolean;
  sonosBaseUrl: string;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "dev-settings.json");

function readFile(): PersistedDevSettings | null {
  if (!existsSync(DATA_FILE)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    const showSimulated =
      typeof v.showSimulated === "boolean"
        ? v.showSimulated
        : typeof v.hideSimulated === "boolean"
          ? !v.hideSimulated
          : null;
    const infoBanner = readInfoBanner(v.infoBanner);
    const infoBannerVisibleFrom = readInfoBannerInstant(v.infoBannerVisibleFrom);
    const infoBannerVisibleUntil = readInfoBannerInstant(v.infoBannerVisibleUntil);
    const performanceRatio = readPerformanceRatio(v.performanceRatio);
    const pushDeviceIds = readPushDeviceIds(v.pushDeviceIds);
    const cardDeviceIds = readPushDeviceIds(v.cardDeviceIds);
    const surplusAlert = readSurplusAlert(v.surplusAlert);
    const mystromEnabled = v.mystromEnabled === true;
    const mystromBaseUrl = typeof v.mystromBaseUrl === "string" ? v.mystromBaseUrl : "";
    const mystromKind = readMystromKind(v.mystromKind);
    const mystromMac = typeof v.mystromMac === "string" ? v.mystromMac : "";
    const mystromToken = typeof v.mystromToken === "string" ? v.mystromToken : "";
    const sonosEnabled =
      typeof v.sonosEnabled === "boolean" ? v.sonosEnabled === true : v.spotifyEnabled === true;
    const sonosBaseUrl = typeof v.sonosBaseUrl === "string" ? v.sonosBaseUrl : "";
    const hadLegacy =
      "siteLocation" in v ||
      "yieldForecast" in v ||
      "serverPauseEnabled" in v ||
      "serverPauseStopAt" in v ||
      "serverPauseResumeAt" in v ||
      "hideSimulated" in v ||
      "spotifyEnabled" in v ||
      "spotifyUrl" in v;
    const file: PersistedDevSettings = {
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
      showSimulated,
      infoBanner,
      infoBannerVisibleFrom,
      infoBannerVisibleUntil,
      performanceRatio,
      pushDeviceIds,
      cardDeviceIds,
      surplusAlert,
      mystromEnabled,
      mystromBaseUrl,
      mystromKind,
      mystromMac,
      mystromToken,
      sonosEnabled,
      sonosBaseUrl,
    };
    // Alte Standort-, Server-Pause-, hideSimulated- und Spotify-Felder beim nächsten Lesen streichen.
    if (hadLegacy) writeFile(file);
    return file;
  } catch {
    return null;
  }
}

function resolvePerformanceRatio(stored: number | null | undefined): number {
  if (stored != null) return stored;
  return resolveOpenMeteoPerformanceRatio();
}

function extraFromFile(file: PersistedDevSettings | null): ExtraCardsSettings {
  return {
    mystromEnabled: file?.mystromEnabled ?? false,
    mystromBaseUrl: file?.mystromBaseUrl ?? "",
    mystromKind: file?.mystromKind ?? "bulb",
    mystromMac: file?.mystromMac ?? "",
    mystromTokenSet: Boolean(file?.mystromToken),
    sonosEnabled: file?.sonosEnabled ?? false,
    sonosBaseUrl: file?.sonosBaseUrl ?? "",
  };
}

function resolve(file: PersistedDevSettings | null): SharedDevSettings {
  return {
    ...extraFromFile(file),
    showSimulated: file?.showSimulated ?? false,
    infoBanner: file?.infoBanner ?? "",
    infoBannerVisibleFrom: file?.infoBannerVisibleFrom ?? null,
    infoBannerVisibleUntil: file?.infoBannerVisibleUntil ?? null,
    performanceRatio: resolvePerformanceRatio(file?.performanceRatio),
    pushDeviceIds: file?.pushDeviceIds ?? [],
    cardDeviceIds: file?.cardDeviceIds ?? [],
    surplusAlert: copySurplusAlert(file?.surplusAlert),
    configured: file != null,
    updatedAt: file?.updatedAt ?? null,
  };
}

/** Ziel für den Server-Abruf. Token bleibt in der Datei. */
export function getMystromTarget(): {
  baseUrl: string;
  kind: MystromKind;
  mac: string;
  token: string;
} | null {
  const file = readFile();
  if (!file?.mystromEnabled) return null;
  return {
    baseUrl: normalizeMystromBaseUrl(file.mystromBaseUrl),
    kind: file.mystromKind,
    mac: file.mystromMac ? normalizeMystromMac(file.mystromMac) : "",
    token: file.mystromToken,
  };
}

/** Ziel für den Sonos-Lautsprecher. */
export function getSonosTarget(): { baseUrl: string } | null {
  const file = readFile();
  if (!file?.sonosEnabled) return null;
  return { baseUrl: file.sonosBaseUrl ? normalizeSonosBaseUrl(file.sonosBaseUrl) : "" };
}

/** Lampe nur, wenn diese Kennung in der Geräteliste bei Karten angehakt ist. */
export function requestMayUseCards(request: Request): boolean {
  const raw = request.headers.get(DEVICE_ID_HEADER);
  if (!isDeviceId(raw)) return false;
  const allowed = readFile()?.cardDeviceIds ?? [];
  return allowed.includes(raw.toLowerCase());
}

function writeFile(next: PersistedDevSettings): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(next, null, 2), "utf8");
}

export function getSharedDevSettings(): SharedDevSettings {
  return resolve(readFile());
}

export function updateSharedDevSettings(update: DevSettingsUpdate): SharedDevSettings {
  const current = readFile();
  const infoBannerVisibleFrom =
    "infoBannerVisibleFrom" in update
      ? normalizeInfoBannerInstant(update.infoBannerVisibleFrom)
      : (current?.infoBannerVisibleFrom ?? null);
  const infoBannerVisibleUntil =
    "infoBannerVisibleUntil" in update
      ? normalizeInfoBannerInstant(update.infoBannerVisibleUntil)
      : (current?.infoBannerVisibleUntil ?? null);
  normalizeInfoBannerSchedule(infoBannerVisibleFrom, infoBannerVisibleUntil);

  const mystromEnabled =
    typeof update.mystromEnabled === "boolean"
      ? update.mystromEnabled
      : (current?.mystromEnabled ?? false);
  const mystromBaseUrl =
    typeof update.mystromBaseUrl === "string"
      ? normalizeMystromBaseUrl(update.mystromBaseUrl)
      : (current?.mystromBaseUrl ?? "");
  const mystromKind =
    update.mystromKind != null
      ? normalizeMystromKind(update.mystromKind)
      : (current?.mystromKind ?? "bulb");
  const mystromMac =
    typeof update.mystromMac === "string"
      ? normalizeMystromMac(update.mystromMac)
      : (current?.mystromMac ?? "");
  // Leer oder weggelassen behält den Token. Nur null löscht ihn.
  let mystromToken = current?.mystromToken ?? "";
  if (update.mystromToken === null) {
    mystromToken = "";
  } else if (typeof update.mystromToken === "string" && update.mystromToken.trim()) {
    mystromToken = normalizeMystromToken(update.mystromToken);
  }
  const sonosEnabled =
    typeof update.sonosEnabled === "boolean"
      ? update.sonosEnabled
      : (current?.sonosEnabled ?? false);
  const sonosBaseUrl =
    typeof update.sonosBaseUrl === "string"
      ? normalizeSonosBaseUrl(update.sonosBaseUrl)
      : (current?.sonosBaseUrl ?? "");

  const next: PersistedDevSettings = {
    updatedAt: new Date().toISOString(),
    showSimulated:
      typeof update.showSimulated === "boolean"
        ? update.showSimulated
        : (current?.showSimulated ?? null),
    infoBanner:
      typeof update.infoBanner === "string"
        ? normalizeInfoBanner(update.infoBanner)
        : (current?.infoBanner ?? ""),
    infoBannerVisibleFrom,
    infoBannerVisibleUntil,
    performanceRatio:
      typeof update.performanceRatio === "number"
        ? normalizePerformanceRatio(update.performanceRatio)
        : (current?.performanceRatio ?? null),
    pushDeviceIds:
      "pushDeviceIds" in update
        ? normalizePushDeviceIds(update.pushDeviceIds)
        : (current?.pushDeviceIds ?? []),
    cardDeviceIds:
      "cardDeviceIds" in update
        ? normalizePushDeviceIds(update.cardDeviceIds)
        : (current?.cardDeviceIds ?? []),
    surplusAlert:
      update.surplusAlert != null
        ? normalizeSurplusAlert(update.surplusAlert)
        : copySurplusAlert(current?.surplusAlert),
    mystromEnabled,
    mystromBaseUrl,
    mystromKind,
    mystromMac,
    mystromToken,
    sonosEnabled,
    sonosBaseUrl,
  };
  writeFile(next);
  return resolve(next);
}
