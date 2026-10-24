"use client";

import { isInstalledApp } from "@/lib/install-prompt";
import { DEVICE_ID_PATTERN } from "@/lib/device-log-shared";

const STORAGE_KEY = "pv-dash:device-id";

let reportPromise: Promise<void> | null = null;

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

/** Grobes Label für die Dev Settings. Der volle User-Agent wird nicht gespeichert. */
export function currentDeviceLabel(): string {
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
  return `${device} · ${surface}`;
}

function sendVisit(): Promise<void> {
  try {
    const id = getOrCreateDeviceId();
    const label = currentDeviceLabel();
    return fetch("/api/device-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, label }),
      keepalive: true,
    }).then(
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
