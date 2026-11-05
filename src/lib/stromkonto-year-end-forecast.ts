/**
 * Prognose Stromkonto-Kontostand per 31.12. anhand vorhandener
 * Jahres-Ertrags-/Verbrauchsdaten. Wird höchstens zweimal täglich neu berechnet
 * (Cache ca. 12 Stunden) und in `.data/` persistiert.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { DailyEnergyPoint } from "@/lib/pv-data";
import { appDayKey, latestAugustResetYear } from "@/lib/stromkonto";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "stromkonto-year-end-forecast.json");
/** Zwei Berechnungen pro Tag ≈ alle 12 Stunden. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

export type YearEndForecast = {
  /** Prognostizierter Kontostand am 31.12. (kWh). */
  balanceKwh: number;
  /** Kalenderjahr der Prognose. */
  asOfYear: number;
  computedAt: string;
  /** Mittlerer Tagesnetto (Ertrag − Verbrauch) der Basisperiode. */
  avgDailyNetKwh: number;
  /** Verbleibende Tage nach heute bis 31.12. */
  remainingDays: number;
  basisYieldKwh: number;
  basisConsumptionKwh: number;
  basisDays: number;
  /**
   * true, wenn die August-Nullung (4.8.) dieses Jahr noch aussteht —
   * dann startet die Prognose ab dem 4.8. bei 0.
   */
  augustResetPending: boolean;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function zurichParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** Tag des Jahres 1…365/366 in Europe/Zurich (1 = 1. Januar). */
export function zurichDayOfYear(date: Date = new Date()): number {
  const { year, month, day } = zurichParts(date);
  let days = day;
  for (let m = 1; m < month; m++) {
    days += new Date(Date.UTC(year, m, 0)).getUTCDate();
  }
  return days;
}

function daysInZurichYear(year: number): number {
  // 29.2. existiert nur in Schaltjahren
  return new Date(Date.UTC(year, 2, 0)).getUTCDate() === 29 ? 366 : 365;
}

/** Tage vom 4. August bis 31. Dezember inklusive. */
function daysFromAugustResetToYearEnd(year: number): number {
  const dayOfAug4 = zurichDayOfYear(new Date(Date.UTC(year, 7, 4, 12)));
  return daysInZurichYear(year) - dayOfAug4 + 1;
}

function readCache(): YearEndForecast | null {
  try {
    if (!existsSync(DATA_FILE)) return null;
    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    if (!Number.isFinite(Number(v.balanceKwh)) || !Number.isFinite(Number(v.asOfYear))) {
      return null;
    }
    if (typeof v.computedAt !== "string") return null;
    return {
      balanceKwh: Number(v.balanceKwh),
      asOfYear: Number(v.asOfYear),
      computedAt: v.computedAt,
      avgDailyNetKwh: Number(v.avgDailyNetKwh) || 0,
      remainingDays: Number(v.remainingDays) || 0,
      basisYieldKwh: Number(v.basisYieldKwh) || 0,
      basisConsumptionKwh: Number(v.basisConsumptionKwh) || 0,
      basisDays: Number(v.basisDays) || 0,
      augustResetPending: Boolean(v.augustResetPending),
    };
  } catch {
    return null;
  }
}

function writeCache(forecast: YearEndForecast): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(forecast, null, 2), "utf8");
}

function cacheIsFresh(cache: YearEndForecast, now: Date): boolean {
  const { year } = zurichParts(now);
  if (cache.asOfYear !== year) return false;
  const age = now.getTime() - Date.parse(cache.computedAt);
  return Number.isFinite(age) && age >= 0 && age < REFRESH_AFTER_MS;
}

/**
 * Summiert Ertrag/Verbrauch der bereits gelaufenen Monate (Jahr-Serie).
 * Künftige Monate (nach dem aktuellen) werden ignoriert.
 */
export function sumYearToDateEnergy(
  yearMonths: DailyEnergyPoint[],
  now: Date = new Date(),
): { yieldKwh: number; consumptionKwh: number } {
  const { month } = zurichParts(now);
  let yieldKwh = 0;
  let consumptionKwh = 0;
  for (let index = 0; index < Math.min(month, yearMonths.length); index++) {
    const point = yearMonths[index];
    yieldKwh += point.yieldKwh;
    consumptionKwh += point.consumptionKwh;
  }
  return { yieldKwh: round(yieldKwh), consumptionKwh: round(consumptionKwh) };
}

export function computeYearEndForecast(input: {
  currentBalanceKwh: number;
  yearMonths: DailyEnergyPoint[];
  now?: Date;
}): YearEndForecast {
  const now = input.now ?? new Date();
  const { year } = zurichParts(now);
  const basis = sumYearToDateEnergy(input.yearMonths, now);
  const basisDays = Math.max(1, zurichDayOfYear(now));
  const avgDailyNetKwh = round((basis.yieldKwh - basis.consumptionKwh) / basisDays);
  const remainingDays = Math.max(0, daysInZurichYear(year) - zurichDayOfYear(now));

  // August-Nullung: vor dem 4.8. startet das Kontojahr noch nicht — Prognose
  // bis 31.12. läuft dann von 0 ab dem 4.8. mit dem gleichen Tagesmittel.
  const augustResetPending = latestAugustResetYear(now) < year;
  let balanceKwh: number;
  if (augustResetPending) {
    balanceKwh = round(avgDailyNetKwh * daysFromAugustResetToYearEnd(year));
  } else {
    balanceKwh = round(input.currentBalanceKwh + avgDailyNetKwh * remainingDays);
  }

  return {
    balanceKwh,
    asOfYear: year,
    computedAt: now.toISOString(),
    avgDailyNetKwh,
    remainingDays,
    basisYieldKwh: basis.yieldKwh,
    basisConsumptionKwh: basis.consumptionKwh,
    basisDays,
    augustResetPending,
  };
}

/**
 * Liefert die gecachte Prognose oder berechnet neu, wenn sie älter als ~12 h ist
 * bzw. das Kalenderjahr gewechselt hat.
 */
export function getYearEndForecast(input: {
  currentBalanceKwh: number;
  yearMonths: DailyEnergyPoint[];
  now?: Date;
  force?: boolean;
}): YearEndForecast {
  const now = input.now ?? new Date();
  const cached = readCache();
  if (!input.force && cached && cacheIsFresh(cached, now)) {
    return cached;
  }
  const forecast = computeYearEndForecast({
    currentBalanceKwh: input.currentBalanceKwh,
    yearMonths: input.yearMonths,
    now,
  });
  writeCache(forecast);
  return forecast;
}

/** Nur Anzeige: Cache ohne Neuberechnung (oder null). */
export function peekYearEndForecast(): YearEndForecast | null {
  return readCache();
}

export function forecastDayKey(date: Date = new Date()): string {
  return appDayKey(date);
}
