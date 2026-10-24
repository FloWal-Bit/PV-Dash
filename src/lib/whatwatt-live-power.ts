/**
 * whatwatt führt die drei Live-Leistungen (PV, Verbrauch, Stromkonto).
 *
 * Der Zähler am Netzanschluss ist aktueller als FusionSolar oder die
 * Simulation. Seine Netzleistung bleibt deshalb unverändert. Passt die
 * Erzeugung der PV-Quelle nicht zur Einspeisung, wird nur die angezeigte
 * Erzeugung angehoben, damit die drei Zahlen physikalisch zusammenpassen:
 * Einspeisung ≤ Erzeugung und Verbrauch = max(0, Erzeugung + gridKw).
 *
 * Der gemerkte Verbrauch liegt im Speicher dieses Node-Prozesses. Ein
 * zweiter Prozess, ein serverloser Kaltstart oder ein Reload des Moduls
 * fängt wieder ohne Verlauf an.
 */

/** Gleiche Schwelle wie die stillen Leitungen im Energiefluss. */
export const LIVE_POWER_IDLE_KW = 0.05;

/**
 * Letzter Verbrauch, der zur PV-Quelle gepasst hat.
 * `null`, solange noch kein solcher Wert angezeigt wurde.
 */
let lastConsistentConsumptionKw: number | null = null;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Einspeisung in kW. Bei Bezug oder Null ist das 0. */
function exportKw(gridKw: number): number {
  return gridKw < 0 ? -gridKw : 0;
}

/**
 * Verbrauch für den unmöglichen Fall (PV-Quelle unter der whatwatt-Einspeisung).
 * Gemerkter Wert zählt, wenn er über der Leerlaufschwelle lag oder schlicht
 * der letzte konsistente Wert vor dem Klemmen auf 0 ist. Ohne Verlauf: 0.
 */
function consumptionWhenPvBelowExport(previousConsumptionKw: number | null): number {
  if (previousConsumptionKw == null || !Number.isFinite(previousConsumptionKw)) return 0;
  return round(Math.max(0, previousConsumptionKw));
}

export type WhatWattLivePower = {
  productionKw: number;
  /** `null`, wenn bei Bezug keine PV-Erzeugung vorliegt und nichts erfunden wird. */
  consumptionKw: number | null;
  /** Unveränderte whatwatt-Netzleistung. Positiv = Bezug, negativ = Einspeisung. */
  gridKw: number;
  /**
   * Verbrauch, der zur PV-Messung gepasst hat und für den nächsten
   * unmöglichen Export gemerkt werden darf. `null` heißt: Speicher nicht anfassen.
   */
  rememberConsumptionKw: number | null;
};

/**
 * Leitet die angezeigten Live-kW aus PV-Quelle und whatwatt-Zähler ab.
 * `previousConsumptionKw` ist der letzte konsistente Verbrauch (oder `null`).
 */
export function reconcileWhatWattLivePower(
  productionKw: number | null,
  gridKw: number,
  previousConsumptionKw: number | null = null,
): WhatWattLivePower {
  const meterKw = gridKw;

  const pvMissing = productionKw == null || !Number.isFinite(productionKw);

  if (!(meterKw < 0)) {
    if (pvMissing) {
      return {
        productionKw: 0,
        consumptionKw: null,
        gridKw: meterKw,
        rememberConsumptionKw: null,
      };
    }
    const production = round(productionKw);
    const consumption = round(Math.max(0, production + meterKw));
    return {
      productionKw: production,
      consumptionKw: consumption,
      gridKw: meterKw,
      rememberConsumptionKw: consumption,
    };
  }

  const feedingInKw = exportKw(meterKw);
  const pvKw = pvMissing ? null : round(productionKw);
  const pvCoversExport = pvKw != null && round(feedingInKw) <= pvKw;

  if (pvCoversExport && pvKw != null) {
    const consumption = round(Math.max(0, pvKw + meterKw));
    return {
      productionKw: pvKw,
      consumptionKw: consumption,
      gridKw: meterKw,
      rememberConsumptionKw: consumption,
    };
  }

  const consumption = consumptionWhenPvBelowExport(previousConsumptionKw);
  return {
    productionKw: round(consumption + feedingInKw),
    consumptionKw: consumption,
    gridKw: meterKw,
    rememberConsumptionKw: null,
  };
}

export function livePowerRates(
  productionKw: number,
  consumptionKw: number | null,
): { selfConsumptionRate: number | null; autarkyRate: number | null } {
  if (consumptionKw == null) {
    return { selfConsumptionRate: null, autarkyRate: null };
  }
  const selfConsumptionRate =
    productionKw > LIVE_POWER_IDLE_KW
      ? Math.min(100, Math.round((Math.min(productionKw, consumptionKw) / productionKw) * 100))
      : 0;
  const autarkyRate =
    consumptionKw > LIVE_POWER_IDLE_KW
      ? Math.min(100, Math.round((Math.min(productionKw, consumptionKw) / consumptionKw) * 100))
      : 0;
  return { selfConsumptionRate, autarkyRate };
}

/** Wendet die Regel an und merkt einen konsistenten Verbrauch in diesem Prozess. */
export function applyWhatWattLivePower(
  productionKw: number | null,
  gridKw: number,
): WhatWattLivePower {
  const result = reconcileWhatWattLivePower(productionKw, gridKw, lastConsistentConsumptionKw);
  if (result.rememberConsumptionKw != null) {
    lastConsistentConsumptionKw = result.rememberConsumptionKw;
  }
  return result;
}

/** Setzt den Prozess-Speicher zurück. Nur für Tests und einen bewussten Neustart. */
export function resetWhatWattLivePowerMemory(): void {
  lastConsistentConsumptionKw = null;
}

export function peekWhatWattLivePowerMemory(): number | null {
  return lastConsistentConsumptionKw;
}
