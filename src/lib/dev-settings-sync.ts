"use client";

import type { DevSettingsUpdate, SharedDevSettings } from "@/lib/dev-settings-shared";
import { hideSimulatedStore } from "@/lib/hide-simulated";
import { infoBannerStore } from "@/lib/info-banner";

let inflightSaves = 0;
let lastUpdatedAt: string | null = null;
let ready = false;

export function applySharedDevSettings(data: SharedDevSettings): void {
  lastUpdatedAt = data.updatedAt;
  hideSimulatedStore.applyRemote(data.hideSimulated);
  infoBannerStore.applyRemote(data.infoBanner);
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
  const hideRaw = window.localStorage.getItem("pv-dash:hide-simulated");
  if (hideRaw !== "0" && hideRaw !== "1") return null;
  return { hideSimulated: hideRaw === "1" };
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

/** Einmal die lokale Anzeige-Wahl hochladen, danach gilt die Serverdatei. */
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
