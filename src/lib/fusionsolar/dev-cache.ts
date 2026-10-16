/**
 * Dauerhafter Zwischenspeicher nur für `next dev`.
 * Ein erfolgreicher Abruf bleibt in `.data/` liegen und übersteht Neustarts
 * und Hot-Reload. Weitere Aufrufe lesen diese Datei und gehen nicht zu Huawei.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DailyEnergyPoint, HistoryPoint, PvSnapshot } from "@/lib/pv-data";

export type FusionSolarDevHistory = {
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
  lifetime: DailyEnergyPoint[];
};

type DevCacheFile = {
  live: PvSnapshot | null;
  history: FusionSolarDevHistory | null;
  /** Nach einem Anfragelimit kein neuer Versuch vor diesem Zeitpunkt. */
  cooldownUntil: number | null;
};

const EMPTY: DevCacheFile = { live: null, history: null, cooldownUntil: null };
const FILE = path.join(process.cwd(), ".data", "fusionsolar-dev-cache.json");

let chain: Promise<void> = Promise.resolve();

export function fusionSolarDevCacheEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

/** Einmaliges Füllen des Zwischenspeichers. Standard aus. */
export function fusionSolarDevFetchEnabled(): boolean {
  return process.env.FUSIONSOLAR_DEV_FETCH === "1";
}

function nextZurichMidnight(now = Date.now()): number {
  const dayKey = new Date(now).toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
  const utcMidnight = Date.parse(`${dayKey}T00:00:00Z`);
  const zurichHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(utcMidnight)),
  );
  const start = utcMidnight - zurichHour * 60 * 60 * 1000;
  return start + 24 * 60 * 60 * 1000;
}

async function readCache(): Promise<DevCacheFile> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<DevCacheFile>;
    return {
      live: parsed.live ?? null,
      history: parsed.history ?? null,
      cooldownUntil: parsed.cooldownUntil ?? null,
    };
  } catch {
    return { ...EMPTY };
  }
}

async function writeCache(next: DevCacheFile): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(next), "utf8");
}

function update(mutate: (current: DevCacheFile) => void): Promise<void> {
  const run = chain.then(async () => {
    const current = await readCache();
    mutate(current);
    await writeCache(current);
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function readFusionSolarDevLive(): Promise<PvSnapshot | null> {
  return (await readCache()).live;
}

export async function readFusionSolarDevHistory(): Promise<FusionSolarDevHistory | null> {
  return (await readCache()).history;
}

export async function fusionSolarDevCooldownActive(): Promise<boolean> {
  const until = (await readCache()).cooldownUntil;
  return until != null && until > Date.now();
}

export function saveFusionSolarDevLive(snapshot: PvSnapshot): Promise<void> {
  return update((current) => {
    current.live = snapshot;
    current.cooldownUntil = null;
  });
}

export function saveFusionSolarDevHistory(history: FusionSolarDevHistory): Promise<void> {
  return update((current) => {
    current.history = history;
    current.cooldownUntil = null;
  });
}

export function noteFusionSolarDevCooldown(): Promise<void> {
  return update((current) => {
    current.cooldownUntil = nextZurichMidnight();
  });
}
