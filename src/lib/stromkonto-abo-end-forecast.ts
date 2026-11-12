/**
 * Prognose Stromkonto-Kontostand per Ende der Abo-Laufzeit
 * (Nacht vom 3. auf den 4. August, vor der Nullung).
 *
 * - Abgeschlossene Ist-Monate + laufender Monat (vollständige Tage) kalibrieren
 *   einen Bias gegen das FusionSolar-Monatsprofil.
 * - Resttage im laufenden Monat: Ist-Tagesnetto (falls genug Tage).
 * - Künftige Monate: Profil × Bias.
 * Cache ca. 12 Stunden in `.data/`.
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
/** Cache-Version: invalidiert v1 (nur Profil). */
const FORECAST_METHOD = "seasonal-monthly-profile-v2-actuals-bias";

/** Abo startet am 4. August und endet am 3. August des Folgejahres. */
const ABO_RESET_MONTH = 8;
const ABO_RESET_DAY = 4;

/** Bias-Fenster: abgeschlossene Monate + MTD, grob letzte ~90 Tage. */
const BIAS_LOOKBACK_DAYS = 90;
/** Mindestens so viele vollständige Ist-Tage im laufenden Monat für Ist-Rate. */
const MIN_MTD_DAYS_FOR_RATE = 3;
/** Unter dieser |Profil|-Summe (kWh) kein Bias (Division / Rauschen). */
const MIN_PROFILE_ABS_KWH = 80;
const BIAS_MIN = 0.55;
const BIAS_MAX = 1.45;

export type AboEndForecast = {
  /** Prognostizierter Kontostand am Abo-Ende, vor der Nullung (kWh). */
  balanceKwh: number;
  /** Letzter Kalendertag der laufenden Abo-Periode (YYYY-MM-DD, Zurich). */
  periodEndsOn: string;
  /** Kontojahr = Kalenderjahr des letzten 4. August-Resets. */
  accountYear: number;
  computedAt: string;
  /**
   * Durchschnittliches Tagesnetto der Resttage
   * (projizierter Restnetto / remainingDays).
   */
  avgDailyNetKwh: number;
  /** Verbleibende volle Tage nach heute bis einschliesslich periodEndsOn. */
  remainingDays: number;
  /** Projizierter Netto-Zuwachs bis Abo-Ende (Ertrag − Verbrauch). */
  projectedNetKwh: number;
  /** Summe Ertrag der Resttage (Ist-Rate und/oder Profil×Bias). */
  basisYieldKwh: number;
  /** Summe Verbrauch der Resttage. */
  basisConsumptionKwh: number;
  /** Gleich remainingDays — Basis für die Restperiode. */
  basisDays: number;
  /** Kurzbeschreibung der Prognose-Methode. */
  methodLabel: string;
  /** Ertrags-Bias (Ist/Profil), 1 = keine Korrektur. */
  yieldBias: number;
  /** Verbrauchs-Bias (Ist/Profil), 1 = keine Korrektur. */
  consumptionBias: number;
};

export type ForecastBias = {
  yieldBias: number;
  consumptionBias: number;
  actualYieldKwh: number;
  actualConsumptionKwh: number;
  profileYieldKwh: number;
  profileConsumptionKwh: number;
  /** z. B. «Sep–Okt + Nov MTD» */
  windowLabel: string;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function monthNamesShort(): string[] {
  return ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
}

/**
 * Vollständige Kalendermonate in der Abo-Periode bis vor dem laufenden Monat.
 * August des Reset-Jahres entfällt (nur anteilig ab dem 4.). Fürs Bias-Fenster
 * höchstens die letzten drei Monate (~90 Tage).
 */
export function completedAboMonthsForBias(now: Date = new Date()): Array<{ year: number; month: number }> {
  const accountYear = latestAugustResetYear(now);
  const { year, month } = zurichParts(now);
  const out: Array<{ year: number; month: number }> = [];

  // Erster voller Monat nach Reset: September des Kontojahres.
  let cursorYear = accountYear;
  let cursorMonth = ABO_RESET_MONTH + 1;
  if (cursorMonth > 12) {
    cursorMonth = 1;
    cursorYear += 1;
  }

  const endYear = month > 1 ? year : year - 1;
  const endMonth = month > 1 ? month - 1 : 12;
  if (endYear < cursorYear || (endYear === cursorYear && endMonth < cursorMonth)) {
    return out;
  }

  while (cursorYear < endYear || (cursorYear === endYear && cursorMonth <= endMonth)) {
    out.push({ year: cursorYear, month: cursorMonth });
    cursorMonth += 1;
    if (cursorMonth > 12) {
      cursorMonth = 1;
      cursorYear += 1;
    }
    if (out.length > 24) break;
  }

  // ~90 Tage: letzte drei abgeschlossenen Monate
  return out.slice(-Math.max(1, Math.floor(BIAS_LOOKBACK_DAYS / 30)));
}

function yearMonthPoint(
  yearMonths: DailyEnergyPoint[] | undefined,
  month: number,
): DailyEnergyPoint | null {
  if (!yearMonths || yearMonths.length < 12) return null;
  const point = yearMonths[month - 1];
  if (!point) return null;
  if (point.yieldKwh <= 0 && point.consumptionKwh <= 0) return null;
  return point;
}

/** Vollständige Ist-Tage 1…yesterday im laufenden Monat. */
export function monthToDateActuals(
  monthDays: DailyEnergyPoint[] | undefined,
  now: Date = new Date(),
): { yieldKwh: number; consumptionKwh: number; days: number } {
  const { day: today } = zurichParts(now);
  if (!monthDays?.length || today <= 1) {
    return { yieldKwh: 0, consumptionKwh: 0, days: 0 };
  }
  let yieldKwh = 0;
  let consumptionKwh = 0;
  let days = 0;
  for (let d = 1; d < today; d++) {
    const point = monthDays.find((p) => p.label === String(d)) ?? monthDays[d - 1];
    if (!point) continue;
    if (point.yieldKwh <= 0 && point.consumptionKwh <= 0) continue;
    yieldKwh += point.yieldKwh;
    consumptionKwh += point.consumptionKwh;
    days += 1;
  }
  return { yieldKwh: round(yieldKwh), consumptionKwh: round(consumptionKwh), days };
}

export function computeForecastBias(input: {
  yearMonths?: DailyEnergyPoint[];
  monthDays?: DailyEnergyPoint[];
  now?: Date;
}): ForecastBias {
  const now = input.now ?? new Date();
  let actualYield = 0;
  let actualConsumption = 0;
  let profileYield = 0;
  let profileConsumption = 0;
  const labels: string[] = [];
  const names = monthNamesShort();

  for (const { year, month } of completedAboMonthsForBias(now)) {
    // yearMonths deckt nur das laufende Kalenderjahr ab
    if (year !== zurichParts(now).year) continue;
    const actual = yearMonthPoint(input.yearMonths, month);
    const profile = profileForMonth(month);
    if (!actual || !profile) continue;
    actualYield += actual.yieldKwh;
    actualConsumption += actual.consumptionKwh;
    profileYield += profile.yieldKwh;
    profileConsumption += profile.consumptionKwh;
    labels.push(names[month - 1]);
  }

  const mtd = monthToDateActuals(input.monthDays, now);
  if (mtd.days >= MIN_MTD_DAYS_FOR_RATE) {
    const { month, year } = zurichParts(now);
    const profile = profileForMonth(month);
    if (profile) {
      const dim = daysInCalendarMonth(year, month);
      actualYield += mtd.yieldKwh;
      actualConsumption += mtd.consumptionKwh;
      profileYield += (profile.yieldKwh / dim) * mtd.days;
      profileConsumption += (profile.consumptionKwh / dim) * mtd.days;
      labels.push(`${names[month - 1]} MTD`);
    }
  }

  const yieldBias =
    profileYield >= MIN_PROFILE_ABS_KWH
      ? clamp(actualYield / profileYield, BIAS_MIN, BIAS_MAX)
      : 1;
  const consumptionBias =
    profileConsumption >= MIN_PROFILE_ABS_KWH
      ? clamp(actualConsumption / profileConsumption, BIAS_MIN, BIAS_MAX)
      : 1;

  let windowLabel = labels.length ? labels.join("–").replace(/–([^–]*MTD)/, " + $1") : "keine Ist-Basis";
  // nicer: "Sep, Okt + Nov MTD"
  if (labels.length > 1) {
    const mtdIdx = labels.findIndex((l) => l.includes("MTD"));
    if (mtdIdx >= 0) {
      const months = labels.filter((l) => !l.includes("MTD"));
      windowLabel = `${months.join(", ")} + ${labels[mtdIdx]}`;
    } else {
      windowLabel = labels.join(", ");
    }
  }

  return {
    yieldBias: round(yieldBias),
    consumptionBias: round(consumptionBias),
    actualYieldKwh: round(actualYield),
    actualConsumptionKwh: round(actualConsumption),
    profileYieldKwh: round(profileYield),
    profileConsumptionKwh: round(profileConsumption),
    windowLabel,
  };
}

function applyBias(yieldKwh: number, consumptionKwh: number, bias: ForecastBias) {
  return {
    yieldKwh: yieldKwh * bias.yieldBias,
    consumptionKwh: consumptionKwh * bias.consumptionBias,
  };
}

/**
 * Projiziert Ertrag/Verbrauch/Netto für alle Tage nach `now` bis Abo-Ende:
 * laufender Monat bevorzugt Ist-Tagesrate, danach Profil × Bias.
 */
export function projectRemainingWithMonthlyProfile(
  now: Date = new Date(),
  options?: {
    yearMonths?: DailyEnergyPoint[];
    monthDays?: DailyEnergyPoint[];
    bias?: ForecastBias;
  },
): {
  yieldKwh: number;
  consumptionKwh: number;
  netKwh: number;
  days: number;
  bias: ForecastBias;
  usedActualCurrentMonth: boolean;
} {
  const remainingDays = remainingDaysUntilAboEnd(now);
  const bias =
    options?.bias ??
    computeForecastBias({
      yearMonths: options?.yearMonths,
      monthDays: options?.monthDays,
      now,
    });

  if (remainingDays <= 0) {
    return {
      yieldKwh: 0,
      consumptionKwh: 0,
      netKwh: 0,
      days: 0,
      bias,
      usedActualCurrentMonth: false,
    };
  }

  const { year: startYear, month: startMonth, day: startDay } = zurichParts(now);
  const endYear = latestAugustResetYear(now) + 1;
  const endMonth = ABO_RESET_MONTH;
  const endDay = ABO_RESET_DAY - 1;

  let yieldKwh = 0;
  let consumptionKwh = 0;
  let usedActualCurrentMonth = false;

  // Rest laufender Monat
  const daysLeftThisMonth = (() => {
    const dim = daysInCalendarMonth(startYear, startMonth);
    let toDay = dim;
    if (startYear === endYear && startMonth === endMonth) {
      toDay = Math.min(toDay, endDay);
    }
    return Math.max(0, toDay - startDay);
  })();

  if (daysLeftThisMonth > 0) {
    const mtd = monthToDateActuals(options?.monthDays, now);
    if (mtd.days >= MIN_MTD_DAYS_FOR_RATE) {
      const dailyY = mtd.yieldKwh / mtd.days;
      const dailyC = mtd.consumptionKwh / mtd.days;
      yieldKwh += dailyY * daysLeftThisMonth;
      consumptionKwh += dailyC * daysLeftThisMonth;
      usedActualCurrentMonth = true;
    } else {
      const profile = profileForMonth(startMonth);
      if (profile) {
        const dim = daysInCalendarMonth(startYear, startMonth);
        const scaled = applyBias(
          (profile.yieldKwh / dim) * daysLeftThisMonth,
          (profile.consumptionKwh / dim) * daysLeftThisMonth,
          bias,
        );
        yieldKwh += scaled.yieldKwh;
        consumptionKwh += scaled.consumptionKwh;
      }
    }
  }

  // Künftige volle/anteilige Monate
  let cursorYear = startYear;
  let cursorMonth = startMonth + 1;
  if (cursorMonth > 12) {
    cursorMonth = 1;
    cursorYear += 1;
  }

  while (
    cursorYear < endYear ||
    (cursorYear === endYear && cursorMonth < endMonth) ||
    (cursorYear === endYear && cursorMonth === endMonth)
  ) {
    const profile = profileForMonth(cursorMonth);
    const daysInMonth = daysInCalendarMonth(cursorYear, cursorMonth);
    if (!profile || daysInMonth <= 0) break;

    const fromDay = 1;
    let toDay = daysInMonth;
    if (cursorYear === endYear && cursorMonth === endMonth) {
      toDay = Math.min(toDay, endDay);
    }

    const days = Math.max(0, toDay - fromDay + 1);
    if (days > 0) {
      const scaled = applyBias(
        (profile.yieldKwh / daysInMonth) * days,
        (profile.consumptionKwh / daysInMonth) * days,
        bias,
      );
      yieldKwh += scaled.yieldKwh;
      consumptionKwh += scaled.consumptionKwh;
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
    bias,
    usedActualCurrentMonth,
  };
}

function methodLabelFor(bias: ForecastBias, usedActualCurrentMonth: boolean): string {
  const parts = [MONTHLY_PROFILE_LABEL];
  if (bias.windowLabel !== "keine Ist-Basis") {
    parts.push(`Bias ${bias.windowLabel}`);
  }
  if (usedActualCurrentMonth) {
    parts.push("Restmonat Ist-Rate");
  }
  return parts.join(" · ");
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
      yieldBias: Number(v.yieldBias) || 1,
      consumptionBias: Number(v.consumptionBias) || 1,
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
 * die Jahres-Serie sie abdeckt (Diagnose / UI-Hilfen).
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
  monthDays?: DailyEnergyPoint[];
  now?: Date;
}): AboEndForecast {
  const now = input.now ?? new Date();
  const accountYear = latestAugustResetYear(now);
  const remainingDays = remainingDaysUntilAboEnd(now);
  const projected = projectRemainingWithMonthlyProfile(now, {
    yearMonths: input.yearMonths,
    monthDays: input.monthDays,
  });
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
    methodLabel: methodLabelFor(projected.bias, projected.usedActualCurrentMonth),
    yieldBias: projected.bias.yieldBias,
    consumptionBias: projected.bias.consumptionBias,
  };
}

/**
 * Liefert die gecachte Prognose oder berechnet neu, wenn sie älter als ~12 h ist
 * bzw. die Abo-Periode gewechselt hat.
 */
export function getAboEndForecast(input: {
  currentBalanceKwh: number;
  yearMonths?: DailyEnergyPoint[];
  monthDays?: DailyEnergyPoint[];
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
    monthDays: input.monthDays,
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
