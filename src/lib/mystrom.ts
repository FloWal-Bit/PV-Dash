/**
 * Lokale myStrom-REST-API.
 * Schalter: GET /relay und /report. Lampe: POST /api/v1/device/<MAC>.
 * Der Node muss die Adresse erreichen. Ein HTTPS-Dashboard im Browser darf
 * die Lampe nicht selbst aufrufen (gemischte Inhalte und Geräte-CORS).
 */

import { getMystromTarget } from "@/lib/dev-settings";

const TIMEOUT_MS = 4_000;

export type MystromState = {
  on: boolean;
};

function deviceHeaders(origin: string, token: string): Headers {
  const headers = new Headers();
  // Mit Accept-Encoding verlangt die Lampe Origin/Referer auf ihre eigene Adresse.
  headers.set("Origin", origin);
  headers.set("Referer", `${origin}/`);
  headers.set("Accept", "application/json, text/plain, */*");
  if (token) headers.set("Token", token);
  return headers;
}

async function callDevice(
  url: string,
  origin: string,
  token: string,
  init?: RequestInit,
): Promise<unknown> {
  const headers = deviceHeaders(origin, token);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method,
      body: init?.body,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Lampe nicht erreichbar. Der Server muss die Adresse im Netz erreichen.");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Die Lampe hat weitergeleitet. Nur die Geräteadresse selbst ist erlaubt.");
  }
  if (!response.ok) {
    throw new Error(`Lampe antwortet mit HTTP ${response.status}.`);
  }
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readOn(body: unknown): boolean | null {
  if (typeof body !== "object" || body == null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.relay === "boolean") return record.relay;
  if (typeof record.on === "boolean") return record.on;
  for (const value of Object.values(record)) {
    if (typeof value !== "object" || value == null) continue;
    const nested = value as Record<string, unknown>;
    if (typeof nested.on === "boolean") return nested.on;
    if (typeof nested.relay === "boolean") return nested.relay;
  }
  return null;
}

function requireTarget() {
  const target = getMystromTarget();
  if (!target) throw new Error("myStrom ist in den Dev-Einstellungen aus.");
  if (!target.baseUrl) throw new Error("myStrom-Adresse fehlt.");
  if (target.kind === "bulb" && !target.mac) throw new Error("MAC der Lampe fehlt.");
  return target;
}

export async function readMystromState(): Promise<MystromState> {
  const target = requireTarget();
  const path =
    target.kind === "bulb" ? `/api/v1/device/${target.mac}` : "/report";
  const body = await callDevice(`${target.baseUrl}${path}`, target.baseUrl, target.token);
  const on = readOn(body);
  if (on == null) throw new Error("Die Lampe hat keinen Zustand geliefert.");
  return { on };
}

export async function setMystromState(on: boolean): Promise<MystromState> {
  const target = requireTarget();
  if (target.kind === "switch") {
    const state = on ? "1" : "0";
    await callDevice(
      `${target.baseUrl}/relay?state=${state}`,
      target.baseUrl,
      target.token,
    );
  } else {
    await callDevice(`${target.baseUrl}/api/v1/device/${target.mac}`, target.baseUrl, target.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `action=${on ? "on" : "off"}`,
    });
  }
  try {
    return await readMystromState();
  } catch {
    return { on };
  }
}
