/**
 * Konfiguration für die whatwatt-Go-Anbindung per MQTT.
 *
 * Anders als die frühere REST-Variante (die einen lokalen Netzwerkzugriff
 * auf das Gerät voraussetzte) funktioniert MQTT auch, wenn die App
 * cloud-gehostet läuft: Das whatwatt Go verbindet sich selbst (ausgehend,
 * kein Portforwarding nötig) zu einem MQTT-Broker im Internet und
 * veröffentlicht dort seine Messwerte; die App abonniert denselben Broker.
 * Siehe README.md, Abschnitt "whatwatt Go-Anbindung", für die Einrichtung
 * von Broker, Gerät und dieser Umgebungsvariablen.
 */

export type WhatWattMqttConfig = {
  /** Broker-URL inkl. Protokoll, z. B. mqtts://<cluster>.hivemq.cloud:8883 */
  url: string;
  username: string;
  password: string;
  /** Topic, auf das das whatwatt Go seine Werte veröffentlicht (muss mit der Geräte-Konfiguration übereinstimmen). */
  topic: string;
};

export function getWhatWattConfig(): WhatWattMqttConfig | null {
  const url = process.env.WHATWATT_MQTT_URL?.trim();
  const username = process.env.WHATWATT_MQTT_USERNAME?.trim();
  const password = process.env.WHATWATT_MQTT_PASSWORD?.trim();
  const topic = process.env.WHATWATT_MQTT_TOPIC?.trim();

  if (!url || !topic) {
    return null;
  }

  return { url, username: username ?? "", password: password ?? "", topic };
}

export function isWhatWattConfigured(): boolean {
  return getWhatWattConfig() !== null;
}
