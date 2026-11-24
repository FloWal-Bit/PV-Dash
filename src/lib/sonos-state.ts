export type SonosNow = {
  room: string;
  title: string;
  artist: string;
  playing: boolean;
};

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function xmlText(xml: string, tagName: string): string {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`, "i").exec(xml);
  if (!match?.[1]) return "";
  return decodeXml(match[1]).replace(/\s+/g, " ").trim();
}

/** Raum, Titel und Wiedergabe aus Gerätebeschreibung, Transport und Position. */
export function parseSonosNow(
  descriptionXml: string,
  transportXml: string,
  positionXml: string,
): SonosNow {
  const state =
    xmlText(transportXml, "CurrentTransportState") || xmlText(transportXml, "TransportState");
  const meta = xmlText(positionXml, "TrackMetaData");
  return {
    room: xmlText(descriptionXml, "roomName"),
    title: xmlText(meta, "dc:title"),
    artist: xmlText(meta, "dc:creator"),
    playing: state === "PLAYING" || state === "TRANSITIONING",
  };
}
