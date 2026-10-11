import { computeStromkonto, meterTotalsSinceZurichDayStart } from "@/lib/stromkonto";
import type { WhatWattMqttMessage } from "./types";

export type WhatWattGridSnapshot = {
  /** Momentaner Netzbezug (positiv) bzw. Einspeisung (negativ) in kW. */
  gridKw: number;
  /** Netzbezug seit Mitternacht in kWh. */
  gridImportTodayKwh: number;
  /** Einspeisung seit Mitternacht in kWh. */
  gridFeedInTodayKwh: number;
  /** Stromkonto-Stand in kWh (Startstand ± laufende Netto-Veränderung). */
  stromkontoBalanceKwh: number;
  /** Netto-Veränderung Stromkonto heute (Einspeisung minus Bezug). */
  stromkontoChangeTodayKwh: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mapMqttMessageToGridSnapshot(
  message: WhatWattMqttMessage,
  now: Date = new Date(),
): WhatWattGridSnapshot {
  if (message.meterStatus && message.meterStatus !== "OK") {
    throw new Error(`whatwatt Go: Zähler-Status "${message.meterStatus}" statt "OK".`);
  }

  const { gridImportTodayKwh, gridFeedInTodayKwh } = meterTotalsSinceZurichDayStart(
    message.energyInKwh,
    message.energyOutKwh,
    now,
  );

  const stromkonto = computeStromkonto(
    message.energyInKwh,
    message.energyOutKwh,
    gridImportTodayKwh,
    gridFeedInTodayKwh,
    now,
  );

  return {
    gridKw: round(message.powerInKw - message.powerOutKw),
    gridImportTodayKwh,
    gridFeedInTodayKwh,
    stromkontoBalanceKwh: stromkonto.balanceKwh,
    stromkontoChangeTodayKwh: stromkonto.changeTodayKwh,
  };
}
