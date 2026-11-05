/**
 * Saisonales Monatsprofil Ertrag/Verbrauch für die Stromkonto-Prognose.
 * Quelle: FusionSolar Statistik «Kronenmatte 3» (manuell aus App-Screenshots).
 *
 * Pro Kalendermonat wird der jeweils aktuellste vollständige Monat genutzt
 * (Sep–Dez 2025, Jan–Aug 2026).
 */

export type MonthlyEnergyProfile = {
  /** Kalendermonat 1…12 */
  month: number;
  /** Referenzjahr des Screenshots */
  referenceYear: number;
  yieldKwh: number;
  consumptionKwh: number;
};

/** kWh; FusionSolar zeigt grosse Werte teils in MWh. */
export const FUSIONSOLAR_MONTHLY_PROFILE: MonthlyEnergyProfile[] = [
  { month: 1, referenceYear: 2026, yieldKwh: 587.08, consumptionKwh: 6550 },
  { month: 2, referenceYear: 2026, yieldKwh: 1340, consumptionKwh: 4590 },
  { month: 3, referenceYear: 2026, yieldKwh: 3140, consumptionKwh: 4890 },
  { month: 4, referenceYear: 2026, yieldKwh: 4290, consumptionKwh: 3350 },
  { month: 5, referenceYear: 2026, yieldKwh: 4490, consumptionKwh: 2870 },
  { month: 6, referenceYear: 2026, yieldKwh: 4500, consumptionKwh: 2090 },
  { month: 7, referenceYear: 2026, yieldKwh: 4960, consumptionKwh: 1650 },
  { month: 8, referenceYear: 2026, yieldKwh: 4080, consumptionKwh: 1920 },
  { month: 9, referenceYear: 2025, yieldKwh: 3020, consumptionKwh: 2140 },
  { month: 10, referenceYear: 2025, yieldKwh: 1680, consumptionKwh: 3440 },
  { month: 11, referenceYear: 2025, yieldKwh: 977.73, consumptionKwh: 5810 },
  { month: 12, referenceYear: 2025, yieldKwh: 467.28, consumptionKwh: 5890 },
];

const BY_MONTH = new Map(
  FUSIONSOLAR_MONTHLY_PROFILE.map((entry) => [entry.month, entry] as const),
);

export function profileForMonth(month: number): MonthlyEnergyProfile | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return BY_MONTH.get(month) ?? null;
}

export function profileNetKwh(month: number): number | null {
  const entry = profileForMonth(month);
  if (!entry) return null;
  return entry.yieldKwh - entry.consumptionKwh;
}

export function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Mittleres Tagesnetto (Ertrag − Verbrauch) laut Profil für diesen Kalendermonat. */
export function profileDailyNetKwh(year: number, month: number): number | null {
  const net = profileNetKwh(month);
  if (net == null) return null;
  return net / daysInCalendarMonth(year, month);
}

export const MONTHLY_PROFILE_LABEL =
  "FusionSolar-Monatsprofil (Sep 2025–Aug 2026)";
