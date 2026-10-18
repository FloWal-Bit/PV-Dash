/**
 * Entwicklereinstellungen auf dem Server, damit jedes Gerät dieselben
 * Werte sieht. Liegt in .data/dev-settings.json, analog zum Stromkonto.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { DevSettingsUpdate, SharedDevSettings } from "@/lib/dev-settings-shared";
import { getDeployedSiteLocation, type SiteLocation } from "@/lib/site-location";
import {
  defaultYieldForecastPlant,
  normalizeYieldForecastPlant,
  type YieldForecastPlant,
} from "@/lib/yield-forecast-settings";

export type { DevSettingsUpdate, SharedDevSettings };

type PersistedDevSettings = {
  updatedAt: string;
  siteLocation: SiteLocation | null;
  yieldForecast: YieldForecastPlant | null;
  hideSimulated: boolean | null;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "dev-settings.json");

function isSiteLocation(value: unknown): value is SiteLocation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const latitude = Number(v.latitude);
  const longitude = Number(v.longitude);
  return (
    typeof v.name === "string" &&
    v.name.trim().length > 0 &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function readFile(): PersistedDevSettings | null {
  if (!existsSync(DATA_FILE)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    return {
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
      siteLocation: isSiteLocation(v.siteLocation) ? normalizeLocation(v.siteLocation) : null,
      yieldForecast:
        typeof v.yieldForecast === "object" && v.yieldForecast !== null
          ? normalizeYieldForecastPlant(v.yieldForecast as Partial<YieldForecastPlant>)
          : null,
      hideSimulated: typeof v.hideSimulated === "boolean" ? v.hideSimulated : null,
    };
  } catch {
    return null;
  }
}

function normalizeLocation(location: SiteLocation): SiteLocation {
  return {
    plz: /^\d{4}$/.test(location.plz.trim()) ? location.plz.trim() : "",
    name: location.name.trim() || "Eigener Standort",
    latitude: Math.round(location.latitude * 1_000_000) / 1_000_000,
    longitude: Math.round(location.longitude * 1_000_000) / 1_000_000,
  };
}

function resolve(file: PersistedDevSettings | null): SharedDevSettings {
  const defaults = defaultYieldForecastPlant();
  return {
    siteLocation: file?.siteLocation ?? getDeployedSiteLocation(),
    siteLocationCustom: file?.siteLocation != null,
    yieldForecast: file?.yieldForecast ?? defaults,
    hideSimulated: file?.hideSimulated ?? true,
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
  const next: PersistedDevSettings = {
    updatedAt: new Date().toISOString(),
    siteLocation: current?.siteLocation ?? null,
    yieldForecast: current?.yieldForecast ?? null,
    hideSimulated: current?.hideSimulated ?? null,
  };
  if (update.siteLocation) {
    if (!isSiteLocation(update.siteLocation)) {
      throw new Error("Ungültiger Standort.");
    }
    next.siteLocation = normalizeLocation(update.siteLocation);
  }
  if (update.yieldForecast) {
    next.yieldForecast = normalizeYieldForecastPlant(update.yieldForecast);
  }
  if (typeof update.hideSimulated === "boolean") {
    next.hideSimulated = update.hideSimulated;
  }
  writeFile(next);
  return resolve(next);
}
