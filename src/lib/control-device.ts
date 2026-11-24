/**
 * Lampe und Spotify gehören zu genau einem Gerät.
 * Das Passwort steht nur in PV_DASH_DEVICE_PASSWORD. Das Gerät hält ein
 * httpOnly-Cookie; auf dem Server liegt davon der SHA-256.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getControlDeviceHash, setControlDeviceHash } from "@/lib/dev-settings";
import type { SharedDevSettings } from "@/lib/dev-settings-shared";

export const CONTROL_DEVICE_COOKIE = "pv-dash-device";
export const CONTROL_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

const MAX_PASSWORD_LENGTH = 200;
const FAILURE_LIMIT = 8;
const BLOCK_MS = 15 * 60 * 1000;

let failures = 0;
let blockedUntil = 0;

export function controlPasswordConfigured(): boolean {
  return (process.env.PV_DASH_DEVICE_PASSWORD ?? "").length > 0;
}

export function controlPasswordMatches(input: string): boolean {
  const expected = process.env.PV_DASH_DEVICE_PASSWORD ?? "";
  if (!expected || !input || input.length > MAX_PASSWORD_LENGTH) return false;
  const actual = createHash("sha256").update(input, "utf8").digest();
  const wanted = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actual, wanted);
}

export function controlPasswordBlocked(): { blocked: boolean; retryAfterSec: number } {
  const wait = blockedUntil - Date.now();
  if (wait <= 0) return { blocked: false, retryAfterSec: 0 };
  return { blocked: true, retryAfterSec: Math.ceil(wait / 1000) };
}

export function noteControlPasswordFailure(): void {
  failures += 1;
  if (failures >= FAILURE_LIMIT) {
    blockedUntil = Date.now() + BLOCK_MS;
    failures = 0;
  }
}

export function noteControlPasswordSuccess(): void {
  failures = 0;
  blockedUntil = 0;
}

export function createControlDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashControlDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function bindControlDevice(token: string): void {
  setControlDeviceHash(hashControlDeviceToken(token));
}

export function readCookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

export function isControlDeviceCookie(cookieHeader: string | null): boolean {
  const token = readCookieValue(cookieHeader, CONTROL_DEVICE_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const stored = getControlDeviceHash();
  if (!/^[a-f0-9]{64}$/.test(stored)) return false;
  const actual = Buffer.from(hashControlDeviceToken(token), "hex");
  const expected = Buffer.from(stored, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function requestHasControlDevice(request: Request): boolean {
  return isControlDeviceCookie(request.headers.get("cookie"));
}

const CONTROL_FIELDS = [
  "mystromEnabled",
  "mystromBaseUrl",
  "mystromKind",
  "mystromMac",
  "mystromToken",
  "spotifyEnabled",
  "spotifyUrl",
] as const;

export function updateTouchesControlCards(update: object): boolean {
  return CONTROL_FIELDS.some((key) => Object.prototype.hasOwnProperty.call(update, key));
}

/** Andere Geräte sehen weder die Karten noch Adresse, MAC oder Spotify-Link. */
export function presentDevSettings(
  settings: SharedDevSettings,
  unlocked: boolean,
): SharedDevSettings {
  if (unlocked) return settings;
  return {
    ...settings,
    mystromEnabled: false,
    mystromBaseUrl: "",
    mystromKind: "bulb",
    mystromMac: "",
    mystromTokenSet: false,
    spotifyEnabled: false,
    spotifyUrl: "",
  };
}

export function cookieSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  return new URL(request.url).protocol === "https:";
}
