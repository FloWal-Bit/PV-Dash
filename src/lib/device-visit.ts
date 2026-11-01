"use client";

import { isInstalledApp } from "@/lib/install-prompt";
import { DEVICE_ID_PATTERN } from "@/lib/device-log-shared";
import { APP_VERSION } from "@/lib/version";

const STORAGE_KEY = "pv-dash:device-id";

let reportPromise: Promise<void> | null = null;

type NavigatorUAData = {
  getHighEntropyValues: (hints: string[]) => Promise<{ model?: string }>;
};

export function readDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;
  } catch {
    return null;
  }
  return null;
}

export function getOrCreateDeviceId(): string {
  const existing = readDeviceId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}

function browserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/.test(userAgent)) return "Opera";
  if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Browser";
}

/** Playwright/Selenium und Headless-Chrome der Cursor-Cloud-Agents. */
function isCursorAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  if (navigator.webdriver) return true;
  return /HeadlessChrome/i.test(navigator.userAgent);
}

function sanitizeModel(raw: string): string | null {
  const text = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  // Platzhalter, wenn Chrome/Android kein Modell liefert
  if (/^(K|wv|Android|iPhone|iPad|iPod|Macintosh|Linux|Windows)$/i.test(text)) return null;
  return text.slice(0, 40);
}

/**
 * Klassischer Android-UA: `Android 13; SM-S918B Build/...` bzw. `GT-I9500`.
 * iPhone/iPad liefern im UA kein Modell.
 */
export function modelFromUserAgent(userAgent: string): string | null {
  const android = /Android [^;]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/i.exec(userAgent);
  if (android?.[1]) return sanitizeModel(android[1]);
  return null;
}

async function modelFromClientHints(): Promise<string | null> {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  if (!uaData?.getHighEntropyValues) return null;
  try {
    const { model } = await uaData.getHighEntropyValues(["model"]);
    return typeof model === "string" ? sanitizeModel(model) : null;
  } catch {
    return null;
  }
}

/** Client Hints (Chromium) oder Fallback aus dem Android-User-Agent. */
export async function resolveDeviceModel(userAgent: string): Promise<string | null> {
  const fromHints = await modelFromClientHints();
  if (fromHints) return fromHints;
  return modelFromUserAgent(userAgent);
}

/** Label für die Dev Settings. Der volle User-Agent wird nicht gespeichert. */
export async function currentDeviceLabel(): Promise<string> {
  if (isCursorAgent()) return "Cursor · Agent";

  const userAgent = window.navigator.userAgent;
  const iPad =
    /iPad/.test(userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);

  let device = "Gerät";
  if (/iPhone|iPod/.test(userAgent)) device = "iPhone";
  else if (iPad) device = "iPad";
  else if (/Android/i.test(userAgent)) device = /Mobile/i.test(userAgent) ? "Android" : "Android-Tablet";
  else if (/Windows/i.test(userAgent)) device = "Windows";
  else if (/CrOS/i.test(userAgent)) device = "Chromebook";
  else if (/Macintosh|Mac OS X/.test(userAgent)) device = "Mac";
  else if (/Linux/i.test(userAgent)) device = "Linux";

  const surface = isInstalledApp() ? "App" : browserName(userAgent);
  const model = await resolveDeviceModel(userAgent);
  if (model) return `${device} · ${model} · ${surface}`;
  return `${device} · ${surface}`;
}

function sendVisit(): Promise<void> {
  try {
    const id = getOrCreateDeviceId();
    return currentDeviceLabel()
      .then((label) =>
        fetch("/api/device-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, label, version: APP_VERSION }),
          keepalive: true,
        }),
      )
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    return Promise.resolve();
  }
}

/** Ein Aufruf pro Seitenladen. Weitere Aufrufe teilen sich denselben Request. */
export function reportDeviceVisit(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!reportPromise) reportPromise = sendVisit();
  return reportPromise;
}
