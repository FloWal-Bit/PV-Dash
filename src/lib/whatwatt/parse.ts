import type { WhatWattMqttMessage } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = readNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

/**
 * Normalisiert eingehende whatwatt-Go-MQTT-Payloads auf das interne Schema.
 *
 * Unterstützt:
 * - flaches PV-Dash-Template (powerInKw, energyInKwh, …)
 * - whatwatt-Standardbeispiel (P_In, P_Out, E_In, E_Out, Meter.DateTime)
 * - OBIS-Kurzformen (1_7_0, 2_7_0, 1_8_0, 2_8_0)
 */
export function parseWhatWattMqttPayload(value: unknown): WhatWattMqttMessage | null {
  if (!isRecord(value)) return null;

  const powerInKw = firstNumber(value.powerInKw, value.P_In, value["1_7_0"]);
  const powerOutKw = firstNumber(value.powerOutKw, value.P_Out, value["2_7_0"]);
  const energyInKwh = firstNumber(value.energyInKwh, value.E_In, value["1_8_0"]);
  const energyOutKwh = firstNumber(value.energyOutKwh, value.E_Out, value["2_8_0"]);

  if (
    powerInKw == null ||
    powerOutKw == null ||
    energyInKwh == null ||
    energyOutKwh == null
  ) {
    return null;
  }

  const meter = isRecord(value.Meter) ? value.Meter : null;
  const dateTimeUtc =
    typeof value.dateTimeUtc === "string"
      ? value.dateTimeUtc
      : meter && typeof meter.DateTime === "string"
        ? meter.DateTime
        : meter && typeof meter.date_time === "string"
          ? meter.date_time
          : "";

  const meterStatus = typeof value.meterStatus === "string" ? value.meterStatus : "OK";

  return {
    meterStatus,
    dateTimeUtc,
    powerInKw,
    powerOutKw,
    energyInKwh,
    energyOutKwh,
  };
}
