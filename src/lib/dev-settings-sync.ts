"use client";

import type { DevSettingsUpdate, SharedDevSettings } from "@/lib/dev-settings-shared";
import { hideSimulatedStore } from "@/lib/hide-simulated";
import { siteLocationStore, type SiteLocation } from "@/lib/site-location";
import { yieldForecastStore, type YieldForecastPlant } from "@/lib/yield-forecast-settings";

let inflightSaves = 0;
let lastUpdatedAt: string | null = null;
let ready = false;

export function applySharedDevSettings(data: SharedDevSettings): void {
  lastUpdatedAt = data.updatedAt;
  siteLocationStore.applyRemote(data.siteLocation, data.siteLocationCustom);
  yieldForecastStore.applyRemote(data.yieldForecast);
  hideSimulatedStore.applyRemote(data.hideSimulated);
}

export async function putDevSettings(update: DevSettingsUpdate): Promise<SharedDevSettings> {
  inflightSaves += 1;
  try {
    const response = await fetch("/api/dev-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    const data = (await response.json()) as SharedDevSettings & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Speichern fehlgeschlagen.");
    }
    applySharedDevSettings(data);
    return data;
  } finally {
    inflightSaves -= 1;
  }
}

function readLocalSeed(): DevSettingsUpdate | null {
  if (typeof window === "undefined") return null;
  const update: DevSettingsUpdate = {};
  try {
    const locationRaw = window.localStorage.getItem("pv-dash:site-location");
    if (locationRaw) {
      const parsed = JSON.parse(locationRaw) as SiteLocation;
      if (parsed && typeof parsed.name === "string") update.siteLocation = parsed;
    }
  } catch {
    // ungültiger Zwischenspeicher
  }
  try {
    const forecastRaw = window.localStorage.getItem("pv-dash:yield-forecast");
    if (forecastRaw) {
      update.yieldForecast = JSON.parse(forecastRaw) as YieldForecastPlant;
    }
  } catch {
    // ungültiger Zwischenspeicher
  }
  const hideRaw = window.localStorage.getItem("pv-dash:hide-simulated");
  if (hideRaw === "0" || hideRaw === "1") update.hideSimulated = hideRaw === "1";
  return update.siteLocation || update.yieldForecast || typeof update.hideSimulated === "boolean"
    ? update
    : null;
}

export async function pullDevSettings(): Promise<void> {
  if (inflightSaves > 0) return;
  const response = await fetch("/api/dev-settings", { cache: "no-store" });
  if (!response.ok) return;
  const data = (await response.json()) as SharedDevSettings;
  if (!data.configured) {
    const seed = readLocalSeed();
    if (seed) {
      await putDevSettings(seed);
      return;
    }
  }
  if (data.updatedAt && data.updatedAt === lastUpdatedAt) return;
  applySharedDevSettings(data);
}

/** Einmal lokale Werte hochladen, danach gilt die Serverdatei. */
export async function ensureDevSettingsReady(): Promise<void> {
  if (ready) return;
  await pullDevSettings();
  ready = true;
}

export function applyLiveDevSettings(data: SharedDevSettings | null | undefined): void {
  if (!data?.configured || inflightSaves > 0) return;
  if (data.updatedAt && data.updatedAt === lastUpdatedAt) return;
  applySharedDevSettings(data);
}
