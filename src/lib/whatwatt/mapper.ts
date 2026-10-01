import { computeStromkonto } from "@/lib/stromkonto";
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

/**
 * whatwatt Go liefert Energie nur als seit Zählerstart kumulierten
 * Gesamtwert (`energyInKwh`/`energyOutKwh`), keinen Tageswert. Um daraus
 * "heute" abzuleiten, merken wir uns pro Kalendertag den zuerst
 * beobachteten Zählerstand als Basislinie und ziehen sie von jedem weiteren
 * Wert ab.
 *
 * Wichtige Einschränkung: Dieser Zustand lebt nur im Server-Prozess-Speicher
 * (kein Persistenzlayer). Ein Neustart des Dashboard-Servers mitten am Tag
 * setzt die Basislinie auf den dann aktuellen Zählerstand zurück – bereits
 * gezählte kWh des Tages würden dabei "verloren" (der Tageswert beginnt de
 * facto neu bei 0). Für eine dauerhaft laufende Installation (der
 * vorgesehene Einsatzzweck) ist das ein seltener Sonderfall; für einen
 * produktionsreifen Einsatz sollte die Basislinie stattdessen in einer
 * kleinen Datei/DB persistiert werden.
 */
let dayBaseline: { day: string; importBaseline: number; feedInBaseline: number } | null = null;

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function computeTodayDelta(cumulativeImportKwh: number, cumulativeFeedInKwh: number, now: Date) {
  const key = localDayKey(now);
  if (!dayBaseline || dayBaseline.day !== key) {
    dayBaseline = { day: key, importBaseline: cumulativeImportKwh, feedInBaseline: cumulativeFeedInKwh };
  } else {
    // Zählerstand darf nur steigen; ein Rückgang deutet auf einen
    // Geräte-/Zähler-Reset hin, nicht auf negative Energie.
    if (cumulativeImportKwh < dayBaseline.importBaseline) dayBaseline.importBaseline = cumulativeImportKwh;
    if (cumulativeFeedInKwh < dayBaseline.feedInBaseline) dayBaseline.feedInBaseline = cumulativeFeedInKwh;
  }

  return {
    gridImportTodayKwh: round(Math.max(0, cumulativeImportKwh - dayBaseline.importBaseline)),
    gridFeedInTodayKwh: round(Math.max(0, cumulativeFeedInKwh - dayBaseline.feedInBaseline)),
  };
}

export function mapMqttMessageToGridSnapshot(
  message: WhatWattMqttMessage,
  now: Date = new Date(),
): WhatWattGridSnapshot {
  if (message.meterStatus && message.meterStatus !== "OK") {
    throw new Error(`whatwatt Go: Zähler-Status "${message.meterStatus}" statt "OK".`);
  }

  const { gridImportTodayKwh, gridFeedInTodayKwh } = computeTodayDelta(
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
