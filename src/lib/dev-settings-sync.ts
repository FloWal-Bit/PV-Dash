"use client";

import type { DevSettingsUpdate, SharedDevSettings } from "@/lib/dev-settings-shared";
import { extraCardsStore } from "@/lib/extra-cards-store";
import { showSimulatedStore } from "@/lib/show-simulated";
import { infoBannerStore } from "@/lib/info-banner";
import { pushAlertStore } from "@/lib/push-alert-settings";
import { yieldForecastStore } from "@/lib/yield-forecast-settings";

let inflightSaves = 0;
let lastUpdatedAt: string | null = null;
let ready = false;

export function applySharedDevSettings(data: SharedDevSettings): void {
  lastUpdatedAt = data.updatedAt;
  showSimulatedStore.applyRemote(data.showSimulated);
  infoBannerStore.applyRemote({
    text: data.infoBanner,
    visibleFrom: data.infoBannerVisibleFrom,
    visibleUntil: data.infoBannerVisibleUntil,
  });
  yieldForecastStore.applyRemotePerformanceRatio(data.performanceRatio);
  pushAlertStore.applyRemote({
    deviceIds: data.pushDeviceIds,
    surplus: data.surplusAlert,
  });
  extraCardsStore.applyRemote({
    mystromEnabled: data.mystromEnabled,
    mystromBaseUrl: data.mystromBaseUrl,
    mystromKind: data.mystromKind,
    mystromMac: data.mystromMac,
    mystromTokenSet: data.mystromTokenSet,
    spotifyEnabled: data.spotifyEnabled,
    spotifyUrl: data.spotifyUrl,
  });
}

let saveChain: Promise<void> = Promise.resolve();

async function putDevSettingsNow(update: DevSettingsUpdate): Promise<SharedDevSettings> {
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

/** Speichern nacheinander, damit zwei schnelle Änderungen sich nicht überschreiben. */
export function putDevSettings(update: DevSettingsUpdate): Promise<SharedDevSettings> {
  const run = saveChain.then(() => putDevSettingsNow(update));
  saveChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readLocalSeed(): DevSettingsUpdate | null {
  if (typeof window === "undefined") return null;
  const showRaw = window.localStorage.getItem("pv-dash:show-simulated");
  if (showRaw === "0" || showRaw === "1") return { showSimulated: showRaw === "1" };
  const hideRaw = window.localStorage.getItem("pv-dash:hide-simulated");
  if (hideRaw === "0" || hideRaw === "1") return { showSimulated: hideRaw === "0" };
  return null;
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
