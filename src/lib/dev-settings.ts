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
import { resolveOpenMeteoPerformanceRatio } from "@/lib/open-meteo-yield/config";

export type { DevSettingsUpdate, SharedDevSettings };

type PersistedDevSettings = {
  updatedAt: string;
  hideSimulated: boolean | null;
  infoBanner: string;
  infoBannerVisibleFrom: string | null;
  infoBannerVisibleUntil: string | null;
  /** null = noch nicht gesetzt → Env/Default. */
  performanceRatio: number | null;
  pushDeviceIds: string[];
  surplusAlert: SurplusAlertSettings;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "dev-settings.json");

function readFile(): PersistedDevSettings | null {
  if (!existsSync(DATA_FILE)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    const hideSimulated = typeof v.hideSimulated === "boolean" ? v.hideSimulated : null;
    const infoBanner = readInfoBanner(v.infoBanner);
    const infoBannerVisibleFrom = readInfoBannerInstant(v.infoBannerVisibleFrom);
    const infoBannerVisibleUntil = readInfoBannerInstant(v.infoBannerVisibleUntil);
    const performanceRatio = readPerformanceRatio(v.performanceRatio);
    const pushDeviceIds = readPushDeviceIds(v.pushDeviceIds);
    const surplusAlert = readSurplusAlert(v.surplusAlert);
    const hadLegacy =
      "siteLocation" in v ||
      "yieldForecast" in v ||
      "serverPauseEnabled" in v ||
      "serverPauseStopAt" in v ||
      "serverPauseResumeAt" in v;
    const file: PersistedDevSettings = {
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
      hideSimulated,
      infoBanner,
      infoBannerVisibleFrom,
      infoBannerVisibleUntil,
      performanceRatio,
      pushDeviceIds,
      surplusAlert,
    };
    // Alte Standort-/Server-Pause-Felder beim nächsten Lesen aus der Datei streichen.
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

function resolve(file: PersistedDevSettings | null): SharedDevSettings {
  return {
    hideSimulated: file?.hideSimulated ?? true,
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

  const next: PersistedDevSettings = {
    updatedAt: new Date().toISOString(),
    hideSimulated:
      typeof update.hideSimulated === "boolean"
        ? update.hideSimulated
        : (current?.hideSimulated ?? null),
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
  };
  writeFile(next);
  return resolve(next);
}
