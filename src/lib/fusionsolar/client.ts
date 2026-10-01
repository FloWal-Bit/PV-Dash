/**
 * Schlanker HTTP-Client für die Huawei FusionSolar Northbound API
 * ("thirdData/..."-Endpunkte). Läuft ausschließlich serverseitig (Next.js
 * Route Handler / Server-Komponenten) – die Zugangsdaten verlassen den
 * Server nie.
 *
 * Auth-Ablauf laut Huawei-Dokumentation:
 * 1. POST /thirdData/login mit { userName, systemCode }.
 * 2. Die Antwort setzt einen `XSRF-TOKEN`-Cookie (30 Minuten gültig, wird bei
 *    jedem Aufruf automatisch verlängert). Ein Account kann nur eine aktive
 *    Session haben – ein erneuter Login invalidiert das vorherige Token.
 * 3. Alle folgenden Aufrufe müssen den Session-Cookie UND einen
 *    `XSRF-TOKEN`-Header mit demselben Wert mitsenden.
 *
 * Weil `fetch` in Node keinen Cookie-Jar wie ein Browser führt, verwalten wir
 * Cookies und Token hier manuell in einem Modul-Singleton (ein Prozess = eine
 * Session, wie von Huawei vorgeschrieben).
 */

import { getFusionSolarConfig } from "./config";
import type {
  BatteryRealKpiItem,
  DevListItem,
  FusionSolarEnvelope,
  InverterRealKpiItem,
  MeterRealKpiItem,
  StationKpiTimeseriesItem,
  StationListItem,
  StationRealKpiItem,
} from "./types";

export class FusionSolarError extends Error {
  constructor(
    message: string,
    public readonly failCode?: number,
  ) {
    super(message);
    this.name = "FusionSolarError";
  }
}

export class FusionSolarRateLimitError extends FusionSolarError {
  constructor(message = "FusionSolar-Anfragelimit erreicht (Fehlercode 407).") {
    super(message, 407);
    this.name = "FusionSolarRateLimitError";
  }
}

export class FusionSolarNotConfiguredError extends FusionSolarError {
  constructor() {
    super("FusionSolar ist nicht konfiguriert (fehlende Umgebungsvariablen).");
    this.name = "FusionSolarNotConfiguredError";
  }
}

/** Fehlercodes, die auf eine ungültige/abgelaufene Session hinweisen und einen erneuten Login rechtfertigen. */
const SESSION_INVALID_FAIL_CODES = new Set([305, 306, 307, 401]);
/** Token 30 Min gültig – wir erneuern konservativ nach 25 Min. */
const TOKEN_TTL_MS = 25 * 60 * 1000;

type Session = {
  cookies: Map<string, string>;
  token: string;
  obtainedAt: number;
};

let session: Session | null = null;
let loginInFlight: Promise<Session> | null = null;

function parseSetCookies(headers: Headers): Map<string, string> {
  const jar = new Map<string, string>();
  const getSetCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const raw = typeof getSetCookie === "function"
    ? getSetCookie.call(headers)
    : (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);

  for (const cookieStr of raw) {
    const [pair] = cookieStr.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
  return jar;
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(): Promise<Session> {
  const config = getFusionSolarConfig();
  if (!config) throw new FusionSolarNotConfiguredError();

  const res = await fetch(`${config.baseUrl}/thirdData/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName: config.username, systemCode: config.systemCode }),
    cache: "no-store",
  });

  const body = (await res.json()) as FusionSolarEnvelope<unknown>;
  if (!res.ok || !body.success) {
    throw new FusionSolarError(
      body.message || `FusionSolar-Login fehlgeschlagen (HTTP ${res.status}).`,
      body.failCode,
    );
  }

  const cookies = parseSetCookies(res.headers);
  const token = cookies.get("XSRF-TOKEN");
  if (!token) {
    throw new FusionSolarError(
      "FusionSolar-Login erfolgreich, aber kein XSRF-TOKEN-Cookie erhalten.",
    );
  }

  const newSession: Session = { cookies, token, obtainedAt: Date.now() };
  session = newSession;
  return newSession;
}

async function ensureSession(forceRelogin = false): Promise<Session> {
  if (!forceRelogin && session && Date.now() - session.obtainedAt < TOKEN_TTL_MS) {
    return session;
  }
  // Dedupe concurrent login attempts so we never trigger Huawei's
  // "one active session per account" rule from two requests at once.
  if (!loginInFlight) {
    loginInFlight = login().finally(() => {
      loginInFlight = null;
    });
  }
  return loginInFlight;
}

async function request<T>(path: string, requestBody: Record<string, unknown>): Promise<T> {
  const config = getFusionSolarConfig();
  if (!config) throw new FusionSolarNotConfiguredError();

  let currentSession = await ensureSession();

  const doRequest = async (s: Session) => {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(s.cookies),
        "XSRF-TOKEN": s.token,
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });
    const body = (await res.json()) as FusionSolarEnvelope<T>;
    return { res, body };
  };

  let { res, body } = await doRequest(currentSession);

  if (!body.success && body.failCode === 407) {
    throw new FusionSolarRateLimitError(body.message ?? undefined);
  }

  if (!body.success && body.failCode && SESSION_INVALID_FAIL_CODES.has(body.failCode)) {
    // Session/token invalid: force a fresh login once and retry.
    currentSession = await ensureSession(true);
    ({ res, body } = await doRequest(currentSession));
  }

  if (!res.ok || !body.success) {
    if (body.failCode === 407) throw new FusionSolarRateLimitError(body.message ?? undefined);
    throw new FusionSolarError(
      body.message || `FusionSolar-Anfrage an ${path} fehlgeschlagen (HTTP ${res.status}).`,
      body.failCode,
    );
  }

  if (body.data === undefined) {
    throw new FusionSolarError(`FusionSolar-Antwort von ${path} enthielt keine Daten.`);
  }
  return body.data;
}

export async function listStations(): Promise<StationListItem[]> {
  return request<StationListItem[]>("/thirdData/stations", { pageNo: 1, pageSize: 100 });
}

export async function getStationRealKpi(stationCodes: string[]): Promise<StationRealKpiItem[]> {
  return request<StationRealKpiItem[]>("/thirdData/getStationRealKpi", {
    stationCodes: stationCodes.join(","),
  });
}

export async function getDevList(stationCodes: string[]): Promise<DevListItem[]> {
  return request<DevListItem[]>("/thirdData/getDevList", {
    stationCodes: stationCodes.join(","),
  });
}

export async function getInverterRealKpi(
  devTypeId: number,
  devIds: number[],
): Promise<InverterRealKpiItem[]> {
  return request<InverterRealKpiItem[]>("/thirdData/getDevRealKpi", {
    devTypeId,
    devIds: devIds.join(","),
  });
}

export async function getBatteryRealKpi(devIds: number[]): Promise<BatteryRealKpiItem[]> {
  return request<BatteryRealKpiItem[]>("/thirdData/getDevRealKpi", {
    devTypeId: 39,
    devIds: devIds.join(","),
  });
}

export async function getMeterRealKpi(
  devTypeId: number,
  devIds: number[],
): Promise<MeterRealKpiItem[]> {
  return request<MeterRealKpiItem[]>("/thirdData/getDevRealKpi", {
    devTypeId,
    devIds: devIds.join(","),
  });
}

export async function getStationHourKpi(
  stationCodes: string[],
  collectTimeMs: number,
): Promise<StationKpiTimeseriesItem[]> {
  return request<StationKpiTimeseriesItem[]>("/thirdData/getKpiStationHour", {
    stationCodes: stationCodes.join(","),
    collectTime: collectTimeMs,
  });
}

export async function getStationDayKpi(
  stationCodes: string[],
  collectTimeMs: number,
): Promise<StationKpiTimeseriesItem[]> {
  return request<StationKpiTimeseriesItem[]>("/thirdData/getKpiStationDay", {
    stationCodes: stationCodes.join(","),
    collectTime: collectTimeMs,
  });
}

export async function getStationMonthKpi(
  stationCodes: string[],
  collectTimeMs: number,
): Promise<StationKpiTimeseriesItem[]> {
  return request<StationKpiTimeseriesItem[]>("/thirdData/getKpiStationMonth", {
    stationCodes: stationCodes.join(","),
    collectTime: collectTimeMs,
  });
}

/**
 * Liefert die Jahresdaten der Anlage seit Inbetriebnahme (inkl. laufendes
 * Jahr) – ein Eintrag pro Kalenderjahr, unabhängig vom `collectTime`-Wert.
 */
export async function getStationYearKpi(
  stationCodes: string[],
  collectTimeMs: number,
): Promise<StationKpiTimeseriesItem[]> {
  return request<StationKpiTimeseriesItem[]>("/thirdData/getKpiStationYear", {
    stationCodes: stationCodes.join(","),
    collectTime: collectTimeMs,
  });
}
