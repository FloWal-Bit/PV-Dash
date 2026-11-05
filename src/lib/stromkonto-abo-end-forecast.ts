/**
 * Prognose Stromkonto-Kontostand per Ende der Abo-Laufzeit
 * (Nacht vom 3. auf den 4. August, vor der Nullung).
 *
 * Resttage werden mit dem saisonalen FusionSolar-Monatsprofil
 * (Ertrag − Verbrauch) projiziert. Wird höchstens zweimal täglich neu
 * berechnet (Cache ca. 12 Stunden) und in `.data/` persistiert.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { DailyEnergyPoint } from "@/lib/pv-data";
import { appDayKey, latestAugustResetYear } from "@/lib/stromkonto";
import {
  MONTHLY_PROFILE_LABEL,
  daysInCalendarMonth,
  profileDailyNetKwh,
  profileForMonth,
} from "@/lib/stromkonto-monthly-profile";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "stromkonto-abo-end-forecast.json");
/** Zwei Berechnungen pro Tag ≈ alle 12 Stunden. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
/** Cache-Version: invalidiert alte YTD-Mittel-Caches. */
const FORECAST_METHOD = "seasonal-monthly-profile-v1";

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
  /**
   * Durchschnittliches Tagesnetto der Resttage laut Monatsprofil
   * (projizierter Restnetto / remainingDays).
   */
  avgDailyNetKwh: number;
  /** Verbleibende volle Tage nach heute bis einschliesslich periodEndsOn. */
  remainingDays: number;
  /** Projizierter Netto-Zuwachs bis Abo-Ende (Ertrag − Verbrauch). */
  projectedNetKwh: number;
  /** Summe Profil-Ertrag der Resttage (anteilig). */
  basisYieldKwh: number;
  /** Summe Profil-Verbrauch der Resttage (anteilig). */
  basisConsumptionKwh: number;
  /** Gleich remainingDays — Profilbasis für die Restperiode. */
  basisDays: number;
  /** Kurzbeschreibung der Prognose-Methode. */
  methodLabel: string;
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

/**
 * Projiziert Ertrag/Verbrauch/Netto für alle Tage nach `now` bis Abo-Ende
 * anhand des Monatsprofils (tageweise anteilig).
 */
export function projectRemainingWithMonthlyProfile(now: Date = new Date()): {
  yieldKwh: number;
  consumptionKwh: number;
  netKwh: number;
  days: number;
} {
  const remainingDays = remainingDaysUntilAboEnd(now);
  if (remainingDays <= 0) {
    return { yieldKwh: 0, consumptionKwh: 0, netKwh: 0, days: 0 };
  }

  const { year: startYear, month: startMonth, day: startDay } = zurichParts(now);
  const endYear = latestAugustResetYear(now) + 1;
  const endMonth = ABO_RESET_MONTH;
  const endDay = ABO_RESET_DAY - 1;

  let yieldKwh = 0;
  let consumptionKwh = 0;
  let cursorYear = startYear;
  let cursorMonth = startMonth;

  while (
    cursorYear < endYear ||
    (cursorYear === endYear && cursorMonth < endMonth) ||
    (cursorYear === endYear && cursorMonth === endMonth)
  ) {
    const profile = profileForMonth(cursorMonth);
    const daysInMonth = daysInCalendarMonth(cursorYear, cursorMonth);
    if (!profile || daysInMonth <= 0) break;

    let fromDay = 1;
    let toDay = daysInMonth;
    if (cursorYear === startYear && cursorMonth === startMonth) {
      fromDay = startDay + 1; // Resttage nach heute
    }
    if (cursorYear === endYear && cursorMonth === endMonth) {
      toDay = Math.min(toDay, endDay);
    }

    const days = Math.max(0, toDay - fromDay + 1);
    if (days > 0) {
      yieldKwh += (profile.yieldKwh / daysInMonth) * days;
      consumptionKwh += (profile.consumptionKwh / daysInMonth) * days;
    }

    if (cursorYear === endYear && cursorMonth === endMonth) break;
    cursorMonth += 1;
    if (cursorMonth > 12) {
      cursorMonth = 1;
      cursorYear += 1;
    }
  }

  return {
    yieldKwh: round(yieldKwh),
    consumptionKwh: round(consumptionKwh),
    netKwh: round(yieldKwh - consumptionKwh),
    days: remainingDays,
  };
}

function readCache(): AboEndForecast | null {
  try {
    if (!existsSync(DATA_FILE)) return null;
    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    if (v.method !== FORECAST_METHOD) return null;
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
      projectedNetKwh: Number(v.projectedNetKwh) || 0,
      basisYieldKwh: Number(v.basisYieldKwh) || 0,
      basisConsumptionKwh: Number(v.basisConsumptionKwh) || 0,
      basisDays: Number(v.basisDays) || 0,
      methodLabel: typeof v.methodLabel === "string" ? v.methodLabel : MONTHLY_PROFILE_LABEL,
    };
  } catch {
    return null;
  }
}

function writeCache(forecast: AboEndForecast): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    DATA_FILE,
    JSON.stringify({ ...forecast, method: FORECAST_METHOD }, null, 2),
    "utf8",
  );
}

function cacheIsFresh(cache: AboEndForecast, now: Date): boolean {
  if (cache.periodEndsOn !== aboPeriodEndsOn(now)) return false;
  if (cache.accountYear !== latestAugustResetYear(now)) return false;
  const age = now.getTime() - Date.parse(cache.computedAt);
  return Number.isFinite(age) && age >= 0 && age < REFRESH_AFTER_MS;
}

/**
 * Summiert Ertrag/Verbrauch der Monate in der laufenden Abo-Periode, soweit
 * die Jahres-Serie sie abdeckt (nur noch Info/Fallback, nicht mehr Hauptpfad).
 */
export function sumAboPeriodToDateEnergy(
  yearMonths: DailyEnergyPoint[],
  now: Date = new Date(),
): { yieldKwh: number; consumptionKwh: number } {
  const { year, month } = zurichParts(now);
  const accountYear = latestAugustResetYear(now);
  let startMonthIndex = 0;
  if (year === accountYear) {
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
  yearMonths?: DailyEnergyPoint[];
  now?: Date;
}): AboEndForecast {
  const now = input.now ?? new Date();
  const accountYear = latestAugustResetYear(now);
  const remainingDays = remainingDaysUntilAboEnd(now);
  const projected = projectRemainingWithMonthlyProfile(now);
  const avgDailyNetKwh =
    remainingDays > 0 ? round(projected.netKwh / remainingDays) : 0;
  const balanceKwh = round(input.currentBalanceKwh + projected.netKwh);

  return {
    balanceKwh,
    periodEndsOn: aboPeriodEndsOn(now),
    accountYear,
    computedAt: now.toISOString(),
    avgDailyNetKwh,
    remainingDays,
    projectedNetKwh: projected.netKwh,
    basisYieldKwh: projected.yieldKwh,
    basisConsumptionKwh: projected.consumptionKwh,
    basisDays: projected.days,
    methodLabel: MONTHLY_PROFILE_LABEL,
  };
}

/**
 * Liefert die gecachte Prognose oder berechnet neu, wenn sie älter als ~12 h ist
 * bzw. die Abo-Periode gewechselt hat.
 */
export function getAboEndForecast(input: {
  currentBalanceKwh: number;
  yearMonths?: DailyEnergyPoint[];
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

/** Exponiert für Tests/Diagnose. */
export function sampleProfileDailyNet(year: number, month: number): number | null {
  return profileDailyNetKwh(year, month);
}
