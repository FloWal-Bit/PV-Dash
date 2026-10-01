/**
 * MQTT-Anbindung an ein whatwatt Go. Das Gerät verbindet sich selbst
 * (ausgehend) zu einem Cloud-MQTT-Broker und veröffentlicht dort laufend
 * seine Messwerte (siehe README.md, Abschnitt "whatwatt Go-Anbindung", für
 * Broker-Einrichtung und Geräte-Konfiguration). Diese App hält dazu eine
 * einzige, dauerhafte Abo-Verbindung zum selben Broker offen und
 * aktualisiert einen In-Memory-Zwischenspeicher, sobald eine neue Nachricht
 * eintrifft – ein API-Aufruf liest daraus nur den zuletzt bekannten Stand,
 * ohne selbst eine Netzwerk-Anfrage auszulösen.
 *
 * Wichtig: Das setzt voraus, dass der Node-Prozess durchgehend läuft (z. B.
 * als Web-Service auf Render/Railway, nicht als serverlose Funktion) –
 * sonst geht die Verbindung bei jedem Kaltstart verloren und müsste sich
 * neu aufbauen (siehe README für Hosting-Empfehlungen).
 */

import mqtt, { type MqttClient } from "mqtt";
import { randomUUID } from "crypto";
import { getWhatWattConfig } from "./config";
import { mapMqttMessageToGridSnapshot, type WhatWattGridSnapshot } from "./mapper";
import { parseWhatWattMqttPayload } from "./parse";

// Erwartetes Publish-Intervall am Gerät liegt typischerweise bei wenigen
// Sekunden bis maximal einer Minute. Bleibt eine Nachricht länger aus, ist
// das ein Hinweis auf ein Verbindungs-/Geräteproblem statt nur eine normale
// Sende-Pause – der Wert wird dann als veraltet statt als aktuell behandelt.
const STALE_AFTER_MS = 5 * 60 * 1000;

type MeterTotals = {
  energyInKwh: number;
  energyOutKwh: number;
};

type State = {
  client: MqttClient;
  latest: { snapshot: WhatWattGridSnapshot; receivedAt: number } | null;
  latestMeters: MeterTotals | null;
  lastError: Error | null;
};

let state: State | null = null;

function ensureClient(): State {
  if (state) return state;

  const config = getWhatWattConfig();
  if (!config) {
    throw new Error("whatwatt Go ist nicht konfiguriert (WHATWATT_MQTT_URL/-TOPIC fehlen).");
  }

  const client = mqtt.connect(config.url, {
    username: config.username || undefined,
    password: config.password || undefined,
    clientId: `pv-dash-${randomUUID().slice(0, 8)}`,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
    clean: true,
  });

  const newState: State = { client, latest: null, latestMeters: null, lastError: null };
  state = newState;

  client.on("connect", () => {
    client.subscribe(config.topic, { qos: 0 }, (err) => {
      if (err) {
        console.error("[whatwatt] MQTT-Abo fehlgeschlagen:", err.message);
        newState.lastError = err;
      }
    });
  });

  client.on("message", (_topic, payload) => {
    try {
      const parsed: unknown = JSON.parse(payload.toString("utf8"));
      const message = parseWhatWattMqttPayload(parsed);
      if (!message) {
        throw new Error("Nachricht entspricht nicht dem erwarteten Schema (Payload-Template prüfen).");
      }
      newState.latest = { snapshot: mapMqttMessageToGridSnapshot(message), receivedAt: Date.now() };
      newState.latestMeters = {
        energyInKwh: message.energyInKwh,
        energyOutKwh: message.energyOutKwh,
      };
      newState.lastError = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      console.error("[whatwatt] MQTT-Nachricht konnte nicht verarbeitet werden:", message);
      newState.lastError = err instanceof Error ? err : new Error(message);
    }
  });

  client.on("error", (err) => {
    console.error("[whatwatt] MQTT-Verbindungsfehler:", err.message);
    newState.lastError = err;
  });

  return newState;
}

export async function getWhatWattGridSnapshot(): Promise<WhatWattGridSnapshot> {
  const current = ensureClient();

  if (!current.latest) {
    throw new Error(
      current.lastError
        ? `whatwatt Go: Noch keine gültige MQTT-Nachricht empfangen (${current.lastError.message}).`
        : "whatwatt Go: Warte auf die erste MQTT-Nachricht vom Gerät.",
    );
  }

  const age = Date.now() - current.latest.receivedAt;
  if (age > STALE_AFTER_MS) {
    throw new Error(
      `whatwatt Go: Letzte MQTT-Nachricht ist ${Math.round(age / 60000)} Minuten alt (Gerät/Broker erreichbar?).`,
    );
  }

  return current.latest.snapshot;
}

/** Letzte kumulierte Zählerstände – für Stromkonto-Anheftung in den Einstellungen. */
export function getLatestWhatWattMeterTotals(): MeterTotals | null {
  if (!state?.latestMeters) return null;
  const age = Date.now() - (state.latest?.receivedAt ?? 0);
  if (age > STALE_AFTER_MS) return null;
  return state.latestMeters;
}
