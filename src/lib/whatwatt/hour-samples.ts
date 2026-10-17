/**
 * whatwatt-Zählerstände alle 5 Minuten, aus den Nachrichten, die sowieso ankommen.
 * Ein abgeschlossenes Intervall ergibt den Haushaltsverbrauch als
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

function zurichWall(ms: number): {
  dayKey: string;
  hour: number;
  minute: number;
  second: number;
  millis: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    dayKey: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
    millis: ((ms % 1000) + 1000) % 1000,
  };
}

function slotKey(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Nächste 5-Minuten-Marke in Schweizer Zeit. Genau in der Mitte zählt die frühere Marke. */
export function nearestFiveMinuteSlot(at: number): { dayKey: string; slotKey: string; distanceMs: number } | null {
  const wall = zurichWall(at);
  const flooredMinute = wall.minute - (wall.minute % 5);
  const intoSlotMs = ((wall.minute % 5) * 60 + wall.second) * 1000 + wall.millis;
  const halfSlotMs = 2.5 * 60 * 1000;
  if (intoSlotMs <= halfSlotMs) {
    return { dayKey: wall.dayKey, slotKey: slotKey(wall.hour, flooredMinute), distanceMs: intoSlotMs };
  }
  const nextTotal = wall.hour * 60 + flooredMinute + 5;
  if (nextTotal >= 24 * 60) return null;
  return {
    dayKey: wall.dayKey,
    slotKey: slotKey(Math.floor(nextTotal / 60), nextTotal % 60),
    distanceMs: 5 * 60 * 1000 - intoSlotMs,
  };
}

function distanceToSlot(at: number, dayKey: string, key: string): number | null {
  const wall = zurichWall(at);
  if (wall.dayKey !== dayKey) return null;
  const [hourText, minuteText] = key.split(":");
  const boundaryMs = (Number(hourText) * 60 + Number(minuteText)) * 60 * 1000;
  const atMs = ((wall.hour * 60 + wall.minute) * 60 + wall.second) * 1000 + wall.millis;
  return Math.abs(atMs - boundaryMs);
}

function emptyFile(dayKey: string): HourFile {
  return { dayKey, firstByHour: {} };
}

async function readFileState(): Promise<HourFile> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<HourFile>;
    if (!parsed.dayKey || !parsed.firstByHour) return emptyFile(zurichWall(Date.now()).dayKey);
    return { dayKey: parsed.dayKey, firstByHour: parsed.firstByHour };
  } catch {
    return emptyFile(zurichWall(Date.now()).dayKey);
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

/** Zählerstand merken, der einer 5-Minuten-Marke am nächsten liegt. Ein späterer, näherer Stand ersetzt ihn. */
export function noteWhatWattHourSample(
  energyInKwh: number,
  energyOutKwh: number,
  at = Date.now(),
): void {
  const slot = nearestFiveMinuteSlot(at);
  if (!slot) return;
  void ensureLoaded().then(() => {
    if (!memory || memory.dayKey !== slot.dayKey) {
      memory = emptyFile(slot.dayKey);
    }
    const existing = memory.firstByHour[slot.slotKey];
    if (existing) {
      const existingDistance = distanceToSlot(existing.at, slot.dayKey, slot.slotKey);
      if (existingDistance != null && existingDistance <= slot.distanceMs) return;
    }
    memory.firstByHour[slot.slotKey] = { energyInKwh, energyOutKwh, at };
    scheduleSave();
  });
}

function nextSlotKey(slotKey: string): string | null {
  const [hourText, minuteText] = slotKey.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const total = hour * 60 + minute + 5;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
  const todayKey = zurichWall(Date.now()).dayKey;
  if (file.dayKey !== todayKey) return today;

  return today.map((point) => {
    const endKey = nextSlotKey(point.time);
    if (!endKey) return point;
    const start = file.firstByHour[point.time];
    const end = file.firstByHour[endKey];
    if (!start || !end) return point;
    const slotHours = 5 / 60;
    const yieldKwh = point.productionKw * slotHours;
    const consumptionKwh = consumptionFromHourBounds(yieldKwh, start, end);
    if (consumptionKwh == null) return point;
    return { ...point, consumptionKw: round(consumptionKwh / slotHours) };
  });
}
