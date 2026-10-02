import type { PvSnapshot } from "@/lib/pv-data";

/**
 * Finanzieller Autarkiegrad (Tagesbasis): Anteil des Verbrauchs, der netto
 * nicht über Netzbezug bezahlt werden muss (Einspeisung rechnet 1:1 gegen Bezug).
 */
export function financialAutarkyRate(snapshot: PvSnapshot): number | null {
  const consumption = snapshot.todayConsumptionKwh;
  const gridImport = snapshot.gridImportTodayKwh;
  const gridFeedIn = snapshot.gridFeedInTodayKwh;

  if (consumption == null || consumption <= 0.05) return null;
  if (gridImport == null || gridFeedIn == null) return null;

  const netImportKwh = Math.max(0, gridImport - gridFeedIn);
  return Math.min(100, Math.round((1 - netImportKwh / consumption) * 100));
}
