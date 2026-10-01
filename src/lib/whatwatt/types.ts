/**
 * Normalisiertes MQTT-Schema nach dem Parsen eingehender whatwatt-Go-Nachrichten
 * (siehe parse.ts). Das Gerät kann das whatwatt-Standardtemplate (P_In/P_Out/…)
 * oder das flache PV-Dash-Template senden – beides wird auf diese Felder gemappt.
 */
export type WhatWattMqttMessage = {
  meterStatus: string;
  dateTimeUtc: string;
  powerInKw: number;
  powerOutKw: number;
  energyInKwh: number;
  energyOutKwh: number;
};
