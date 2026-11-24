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
  normalizeSpotifyUrl,
  readMystromKind,
  type ExtraCardsSettings,
  type MystromKind,
} from "@/lib/extra-cards-shared";
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
  surplusAlert: SurplusAlertSettings;
  mystromEnabled: boolean;
  mystromBaseUrl: string;
  mystromKind: MystromKind;
  mystromMac: string;
  mystromToken: string;
  spotifyEnabled: boolean;
  spotifyUrl: string;
  /** SHA-256 des Geräte-Cookies. Leer = kein Gerät freigegeben. */
  controlDeviceHash: string;
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
    const surplusAlert = readSurplusAlert(v.surplusAlert);
    const mystromEnabled = v.mystromEnabled === true;
    const mystromBaseUrl = typeof v.mystromBaseUrl === "string" ? v.mystromBaseUrl : "";
    const mystromKind = readMystromKind(v.mystromKind);
    const mystromMac = typeof v.mystromMac === "string" ? v.mystromMac : "";
    const mystromToken = typeof v.mystromToken === "string" ? v.mystromToken : "";
    const spotifyEnabled = v.spotifyEnabled === true;
    const spotifyUrl = typeof v.spotifyUrl === "string" ? v.spotifyUrl : "";
    const controlDeviceHash =
      typeof v.controlDeviceHash === "string" && /^[a-f0-9]{64}$/.test(v.controlDeviceHash)
        ? v.controlDeviceHash
        : "";
    const hadLegacy =
      "siteLocation" in v ||
      "yieldForecast" in v ||
      "serverPauseEnabled" in v ||
      "serverPauseStopAt" in v ||
      "serverPauseResumeAt" in v ||
      "hideSimulated" in v;
    const file: PersistedDevSettings = {
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
      showSimulated,
      infoBanner,
      infoBannerVisibleFrom,
      infoBannerVisibleUntil,
      performanceRatio,
      pushDeviceIds,
      surplusAlert,
      mystromEnabled,
      mystromBaseUrl,
      mystromKind,
      mystromMac,
      mystromToken,
      spotifyEnabled,
      spotifyUrl,
      controlDeviceHash,
    };
    // Alte Standort-, Server-Pause- und hideSimulated-Felder beim nächsten Lesen streichen.
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
    spotifyEnabled: file?.spotifyEnabled ?? false,
    spotifyUrl: file?.spotifyUrl ?? "",
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
  const spotifyEnabled =
    typeof update.spotifyEnabled === "boolean"
      ? update.spotifyEnabled
      : (current?.spotifyEnabled ?? false);
  const spotifyUrl =
    typeof update.spotifyUrl === "string"
      ? normalizeSpotifyUrl(update.spotifyUrl)
      : (current?.spotifyUrl ?? "");

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
    surplusAlert:
      update.surplusAlert != null
        ? normalizeSurplusAlert(update.surplusAlert)
        : copySurplusAlert(current?.surplusAlert),
    mystromEnabled,
    mystromBaseUrl,
    mystromKind,
    mystromMac,
    mystromToken,
    spotifyEnabled,
    spotifyUrl,
    controlDeviceHash: current?.controlDeviceHash ?? "",
  };
  writeFile(next);
  return resolve(next);
}

export function getControlDeviceHash(): string {
  return readFile()?.controlDeviceHash ?? "";
}

/** Bindet das eine Gerät. Ersetzt eine frühere Freigabe. */
export function setControlDeviceHash(hash: string): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error("Gerätekennung ist ungültig.");
  }
  if (!readFile()) updateSharedDevSettings({});
  const file = readFile();
  if (!file) throw new Error("Einstellungen konnten nicht gespeichert werden.");
  writeFile({ ...file, controlDeviceHash: hash, updatedAt: new Date().toISOString() });
}
