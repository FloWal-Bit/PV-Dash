/**
 * Erste MQTT-Nachricht nach Node-Start fehlt oft noch kurz —
 * kein echter Ausfall, Pull-to-Refresh wäre Sekunden später ok.
 */

export function isWhatWattFirstMessageWarmup(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("Warte auf die erste MQTT-Nachricht") ||
    message.includes("Noch keine gültige MQTT-Nachricht empfangen")
  );
}
