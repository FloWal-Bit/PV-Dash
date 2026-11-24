import { getSonosTarget } from "@/lib/dev-settings";
import { parseSonosNow, type SonosNow } from "@/lib/sonos-state";

const TIMEOUT_MS = 4_000;
const AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";

export type { SonosNow };
export type SonosAction = "play" | "pause" | "next" | "previous";

function targetBase(): string {
  const target = getSonosTarget();
  if (!target) throw new Error("Sonos ist in den Dev-Einstellungen aus.");
  if (!target.baseUrl) throw new Error("Sonos-Adresse fehlt.");
  return target.baseUrl;
}

async function readText(url: string, init: RequestInit = {}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error(
      "Sonos nicht erreichbar. Der Server muss den Lautsprecher im lokalen Netz ansprechen können.",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Sonos-Adresse leitet weiter. Das ist nicht erlaubt.");
  }
  const text = await response.text();
  if (!response.ok) throw new Error("Sonos hat die Anfrage abgelehnt.");
  return text;
}

async function soap(base: string, action: string, inner = ""): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${AV_TRANSPORT}">
      <InstanceID>0</InstanceID>${inner}
    </u:${action}>
  </s:Body>
</s:Envelope>`;
  return readText(`${base}/MediaRenderer/AVTransport/Control`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${AV_TRANSPORT}#${action}"`,
    },
    body,
  });
}

export async function readSonosNow(): Promise<SonosNow> {
  const base = targetBase();
  const [description, transport, position] = await Promise.all([
    readText(`${base}/xml/device_description.xml`).catch(() => ""),
    soap(base, "GetTransportInfo"),
    soap(base, "GetPositionInfo"),
  ]);
  return parseSonosNow(description, transport, position);
}

export async function controlSonos(action: SonosAction): Promise<SonosNow> {
  const base = targetBase();
  if (action === "play") await soap(base, "Play", "<Speed>1</Speed>");
  else if (action === "pause") await soap(base, "Pause");
  else if (action === "next") await soap(base, "Next");
  else await soap(base, "Previous");
  return readSonosNow();
}
