import weatherSymbols from "@/lib/wetteralarm/weather-symbols-de.json";

const SYMBOL_LABELS: Record<string, string> = weatherSymbols;

export function weatherLabelFromSymbol(symbol: number | undefined, symbolV2?: number): string {
  const key = String(symbolV2 ?? symbol ?? "");
  return SYMBOL_LABELS[key] ?? "–";
}

/** Grobe Icon-Kategorie für die Dashboard-Anzeige (PV nutzt vier Stufen). */
export function weatherCategoryFromLabel(label: string): "sonnig" | "leicht bewölkt" | "bewölkt" | "regnerisch" {
  const lower = label.toLowerCase();
  if (/regen|nass|schauer|gewitter|schnee|winterlich|dauerregen/.test(lower)) {
    return "regnerisch";
  }
  if (/bedeckt|stark bewölkt|neblig|bewölkt/.test(lower)) {
    return "bewölkt";
  }
  if (/leicht|teilweise|wechsel|zeitweise|meist klar|überwiegend/.test(lower)) {
    return "leicht bewölkt";
  }
  return "sonnig";
}
