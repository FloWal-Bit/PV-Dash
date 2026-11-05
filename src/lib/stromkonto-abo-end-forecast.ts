/**
 * Prognose Stromkonto-Kontostand per Ende der Abo-Laufzeit
 * (Nacht vom 3. auf den 4. August, vor der Nullung).
 * Wird höchstens zweimal täglich neu berechnet (Cache ca. 12 Stunden)
 * und in `.data/` persistiert.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { DailyEnergyPoint } from "@/lib/pv-data";
import { appDayKey, latestAugustResetYear } from "@/lib/stromkonto";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "stromkonto-abo-end-forecast.json");
/** Zwei Berechnungen pro Tag ≈ alle 12 Stunden. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

/** Abo startet am 4. August und endet am 3. August des Folgejahres. */
const ABO_RESET_MONTH = 8;
const ABO_RESET_DAY = 4;

export type AboEndForecast = {
  /** Prognostizierter Kontostand am Abo-Ende, vor der Nullung (kWh). */
  balanceKwh: number;
  /** Letzter Kalendertag der laufenden Abo-Periode (YYYY-MM-DD, Zurich). */
  periodEndsOn: string;
  /** Kontojahr = Kalenderjahr des letzten 4. August-Resets. */
  accountYear: number;
  computedAt: string;
  /** Mittlerer Tagesnetto (Ertrag − Verbrauch) der Basisperiode. */
  avgDailyNetKwh: number;
  /** Verbleibende volle Tage nach heute bis einschliesslich periodEndsOn. */
  remainingDays: number;
  basisYieldKwh: number;
  basisConsumptionKwh: number;
  basisDays: number;
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
  return new Date(Date.UTC(year, 2, 0)).getUTCDate() === 29 ? 366 : 365;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Letzter Tag der laufenden Abo-Periode (3.8. des Folgejahres nach dem Reset). */
export function aboPeriodEndsOn(now: Date = new Date()): string {
  const endYear = latestAugustResetYear(now) + 1;
  return `${endYear}-${pad2(ABO_RESET_MONTH)}-${pad2(ABO_RESET_DAY - 1)}`;
}

/**
 * Tage seit dem letzten 4. August (inklusive heute), Europe/Zurich.
 * Am Reset-Tag selbst: 1.
 */
export function daysSinceAugustReset(now: Date = new Date()): number {
  const { year, month, day } = zurichParts(now);
  const accountYear = latestAugustResetYear(now);
  if (year === accountYear && month === ABO_RESET_MONTH && day === ABO_RESET_DAY) {
    return 1;
  }
  if (year === accountYear) {
    const dayOfAug4 = zurichDayOfYear(
      new Date(Date.UTC(accountYear, ABO_RESET_MONTH - 1, ABO_RESET_DAY, 12)),
    );
    return Math.max(1, zurichDayOfYear(now) - dayOfAug4 + 1);
  }
  // Jan … 3.8. des Folgejahres: Rest von accountYear + Tage im neuen Jahr
  const dayOfAug4 = zurichDayOfYear(
    new Date(Date.UTC(accountYear, ABO_RESET_MONTH - 1, ABO_RESET_DAY, 12)),
  );
  const daysInAccountYearAfterReset = daysInZurichYear(accountYear) - dayOfAug4 + 1;
  return Math.max(1, daysInAccountYearAfterReset + zurichDayOfYear(now));
}

/** Verbleibende volle Tage nach heute bis einschliesslich 3.8. (Abo-Ende). */
export function remainingDaysUntilAboEnd(now: Date = new Date()): number {
  const accountYear = latestAugustResetYear(now);
  const endYear = accountYear + 1;
  const { year, month, day } = zurichParts(now);
  const endDayOfYear = zurichDayOfYear(
    new Date(Date.UTC(endYear, ABO_RESET_MONTH - 1, ABO_RESET_DAY - 1, 12)),
  );

  if (year < endYear) {
    const daysLeftThisYear = daysInZurichYear(year) - zurichDayOfYear(now);
    return Math.max(0, daysLeftThisYear + endDayOfYear);
  }
  if (year === endYear) {
    if (month > ABO_RESET_MONTH || (month === ABO_RESET_MONTH && day > ABO_RESET_DAY - 1)) {
      return 0;
    }
    return Math.max(0, endDayOfYear - zurichDayOfYear(now));
  }
  return 0;
}

function readCache(): AboEndForecast | null {
  try {
    if (!existsSync(DATA_FILE)) return null;
    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    if (!Number.isFinite(Number(v.balanceKwh)) || typeof v.periodEndsOn !== "string") {
      return null;
    }
    if (typeof v.computedAt !== "string") return null;
    return {
      balanceKwh: Number(v.balanceKwh),
      periodEndsOn: v.periodEndsOn,
      accountYear: Number(v.accountYear) || 0,
      computedAt: v.computedAt,
      avgDailyNetKwh: Number(v.avgDailyNetKwh) || 0,
      remainingDays: Number(v.remainingDays) || 0,
      basisYieldKwh: Number(v.basisYieldKwh) || 0,
      basisConsumptionKwh: Number(v.basisConsumptionKwh) || 0,
      basisDays: Number(v.basisDays) || 0,
    };
  } catch {
    return null;
  }
}

function writeCache(forecast: AboEndForecast): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(forecast, null, 2), "utf8");
}

function cacheIsFresh(cache: AboEndForecast, now: Date): boolean {
  if (cache.periodEndsOn !== aboPeriodEndsOn(now)) return false;
  if (cache.accountYear !== latestAugustResetYear(now)) return false;
  const age = now.getTime() - Date.parse(cache.computedAt);
  return Number.isFinite(age) && age >= 0 && age < REFRESH_AFTER_MS;
}

/**
 * Summiert Ertrag/Verbrauch der Monate in der laufenden Abo-Periode, soweit
 * die Jahres-Serie sie abdeckt. Vor dem 4.8. fehlen Aug–Dez des Vorjahres in
 * der aktuellen Jahr-Serie — dann YTD ab Januar als Näherung.
 */
export function sumAboPeriodToDateEnergy(
  yearMonths: DailyEnergyPoint[],
  now: Date = new Date(),
): { yieldKwh: number; consumptionKwh: number } {
  const { year, month } = zurichParts(now);
  const accountYear = latestAugustResetYear(now);
  let startMonthIndex = 0; // 0 = Januar
  if (year === accountYear) {
    // Abo läuft seit 4.8. dieses Jahres → Monate ab August
    startMonthIndex = ABO_RESET_MONTH - 1;
  }
  let yieldKwh = 0;
  let consumptionKwh = 0;
  for (let index = startMonthIndex; index < Math.min(month, yearMonths.length); index++) {
    const point = yearMonths[index];
    yieldKwh += point.yieldKwh;
    consumptionKwh += point.consumptionKwh;
  }
  return { yieldKwh: round(yieldKwh), consumptionKwh: round(consumptionKwh) };
}

export function computeAboEndForecast(input: {
  currentBalanceKwh: number;
  yearMonths: DailyEnergyPoint[];
  now?: Date;
}): AboEndForecast {
  const now = input.now ?? new Date();
  const { year } = zurichParts(now);
  const accountYear = latestAugustResetYear(now);
  const basis = sumAboPeriodToDateEnergy(input.yearMonths, now);
  // Vor dem 4.8. fehlen Aug–Dez des Vorjahres in der Jahr-Serie → YTD-Tage.
  // Ab dem 4.8. passen Serie (Monate ab August) und Tage seit Reset zusammen.
  const basisDays =
    year === accountYear ? daysSinceAugustReset(now) : Math.max(1, zurichDayOfYear(now));
  const avgDailyNetKwh = round((basis.yieldKwh - basis.consumptionKwh) / Math.max(1, basisDays));
  const remainingDays = remainingDaysUntilAboEnd(now);
  const balanceKwh = round(input.currentBalanceKwh + avgDailyNetKwh * remainingDays);

  return {
    balanceKwh,
    periodEndsOn: aboPeriodEndsOn(now),
    accountYear,
    computedAt: now.toISOString(),
    avgDailyNetKwh,
    remainingDays,
    basisYieldKwh: basis.yieldKwh,
    basisConsumptionKwh: basis.consumptionKwh,
    basisDays,
  };
}

/**
 * Liefert die gecachte Prognose oder berechnet neu, wenn sie älter als ~12 h ist
 * bzw. die Abo-Periode gewechselt hat.
 */
export function getAboEndForecast(input: {
  currentBalanceKwh: number;
  yearMonths: DailyEnergyPoint[];
  now?: Date;
  force?: boolean;
}): AboEndForecast {
  const now = input.now ?? new Date();
  const cached = readCache();
  if (!input.force && cached && cacheIsFresh(cached, now)) {
    return cached;
  }
  const forecast = computeAboEndForecast({
    currentBalanceKwh: input.currentBalanceKwh,
    yearMonths: input.yearMonths,
    now,
  });
  writeCache(forecast);
  return forecast;
}

/** Nur Anzeige: Cache ohne Neuberechnung (oder null). */
export function peekAboEndForecast(): AboEndForecast | null {
  return readCache();
}

export function forecastDayKey(date: Date = new Date()): string {
  return appDayKey(date);
}
