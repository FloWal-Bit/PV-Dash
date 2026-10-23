/**
 * Gemeinsame Entwicklereinstellungen ohne Ort und ohne Anlagenkoordinaten.
 * Liegt in .data/dev-settings.json. Standort bleibt auf dem Gerät.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  readInfoBanner,
  normalizeInfoBanner,
  type DevSettingsUpdate,
  type SharedDevSettings,
} from "@/lib/dev-settings-shared";

export type { DevSettingsUpdate, SharedDevSettings };

type PersistedDevSettings = {
  updatedAt: string;
  hideSimulated: boolean | null;
  infoBanner: string;
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
    const hadLocation = "siteLocation" in v || "yieldForecast" in v;
    const file: PersistedDevSettings = {
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
      hideSimulated,
      infoBanner,
    };
    if (hadLocation) writeFile(file);
    return file;
  } catch {
    return null;
  }
}

function resolve(file: PersistedDevSettings | null): SharedDevSettings {
  return {
    hideSimulated: file?.hideSimulated ?? true,
    infoBanner: file?.infoBanner ?? "",
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
    hideSimulated:
      typeof update.hideSimulated === "boolean"
        ? update.hideSimulated
        : (current?.hideSimulated ?? null),
    infoBanner:
      typeof update.infoBanner === "string"
        ? normalizeInfoBanner(update.infoBanner)
        : (current?.infoBanner ?? ""),
  };
  writeFile(next);
  return resolve(next);
}
