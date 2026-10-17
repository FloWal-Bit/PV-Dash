/**
 * Stündliche whatwatt-Zählerstände aus den Nachrichten, die sowieso ankommen.
 * Eine abgeschlossene Stunde ergibt den Haushaltsverbrauch als
 * Ertrag + Bezug − Einspeisung, ohne einen weiteren FusionSolar-Abruf.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HistoryPoint } from "@/lib/pv-data";

type Sample = {
  energyInKwh: number;
  energyOutKwh: number;
  at: number;
};

type HourFile = {
  dayKey: string;
  firstByHour: Record<string, Sample>;
};

const FILE = path.join(process.cwd(), ".data", "whatwatt-hour-samples.json");
const SAVE_INTERVAL_MS = 60_000;

let memory: HourFile | null = null;
let loaded: Promise<void> | null = null;
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function zurichParts(ms: number): { dayKey: string; hourKey: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    dayKey: `${value("year")}-${value("month")}-${value("day")}`,
    hourKey: `${value("hour")}:00`,
  };
}

function emptyFile(dayKey: string): HourFile {
  return { dayKey, firstByHour: {} };
}

async function readFileState(): Promise<HourFile> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<HourFile>;
    if (!parsed.dayKey || !parsed.firstByHour) return emptyFile(zurichParts(Date.now()).dayKey);
    return { dayKey: parsed.dayKey, firstByHour: parsed.firstByHour };
  } catch {
    return emptyFile(zurichParts(Date.now()).dayKey);
  }
}

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = readFileState().then((file) => {
      memory = file;
    });
  }
  return loaded;
}

function scheduleSave(): void {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty || !memory) return;
    dirty = false;
    const snapshot = memory;
    const run = chain.then(async () => {
      await mkdir(path.dirname(FILE), { recursive: true });
      await writeFile(FILE, JSON.stringify(snapshot), "utf8");
    });
    chain = run.catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      console.error("[whatwatt] Stundenstände konnten nicht gespeichert werden:", message);
    });
  }, SAVE_INTERVAL_MS);
  saveTimer.unref?.();
}

/** Erste Nachricht jeder Schweizer Stunde merken. Spätere Nachrichten derselben Stunde bleiben liegen. */
export function noteWhatWattHourSample(
  energyInKwh: number,
  energyOutKwh: number,
  at = Date.now(),
): void {
  void ensureLoaded().then(() => {
    const { dayKey, hourKey } = zurichParts(at);
    if (!memory || memory.dayKey !== dayKey) {
      memory = emptyFile(dayKey);
    }
    if (memory.firstByHour[hourKey]) return;
    memory.firstByHour[hourKey] = { energyInKwh, energyOutKwh, at };
    scheduleSave();
  });
}

function nextHourKey(hourKey: string): string | null {
  const hour = Number(hourKey.slice(0, 2));
  if (!Number.isInteger(hour) || hour < 0 || hour > 22) return null;
  return `${String(hour + 1).padStart(2, "0")}:00`;
}

/** Verbrauch einer abgeschlossenen Stunde. `null`, solange Anfang oder Ende fehlen. */
export function consumptionFromHourBounds(
  yieldKwh: number,
  start: Sample,
  end: Sample,
): number | null {
  const imported = end.energyInKwh - start.energyInKwh;
  const exported = end.energyOutKwh - start.energyOutKwh;
  if (imported < -0.01 || exported < -0.01) return null;
  return round(Math.max(0, yieldKwh + imported - exported));
}

export async function applyWhatWattHourConsumption(today: HistoryPoint[]): Promise<HistoryPoint[]> {
  await ensureLoaded();
  const file = memory;
  if (!file) return today;
  const todayKey = zurichParts(Date.now()).dayKey;
  if (file.dayKey !== todayKey) return today;

  return today.map((point) => {
    const endKey = nextHourKey(point.time);
    if (!endKey) return point;
    const start = file.firstByHour[point.time];
    const end = file.firstByHour[endKey];
    if (!start || !end) return point;
    const consumptionKw = consumptionFromHourBounds(point.productionKw, start, end);
    if (consumptionKw == null) return point;
    return { ...point, consumptionKw };
  });
}
