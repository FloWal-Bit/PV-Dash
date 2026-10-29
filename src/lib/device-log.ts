/**
 * Aufrufe von PV Dash, gruppiert nach Gerät.
 * Liegt in .data/device-log.json. Die Kennung entsteht im Browser und
 * bleibt dort; der Server speichert nur diese Kennung, ein grobes Label,
 * die App-Version und die Zeitpunkte.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  MAX_TRACKED_DEVICES,
  isDeviceId,
  normalizeDeviceLabel,
  normalizeDeviceVersion,
  type DeviceLogSummary,
  type DeviceVisit,
} from "@/lib/device-log-shared";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "device-log.json");
const TIME_ZONE = "Europe/Zurich";

function zurichDay(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function isDeviceVisit(value: unknown): value is DeviceVisit {
  if (typeof value !== "object" || value === null) return false;
  const visit = value as Record<string, unknown>;
  return (
    isDeviceId(visit.id) &&
    typeof visit.label === "string" &&
    typeof visit.firstSeen === "string" &&
    typeof visit.lastSeen === "string" &&
    typeof visit.hits === "number" &&
    Number.isInteger(visit.hits) &&
    visit.hits >= 1 &&
    zurichDay(visit.firstSeen) != null &&
    zurichDay(visit.lastSeen) != null
  );
}

function readDevices(): DeviceVisit[] {
  if (!existsSync(DATA_FILE)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("devices" in parsed)) return [];
    const raw = (parsed as { devices: unknown }).devices;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isDeviceVisit).map((device) => ({
      ...device,
      label: normalizeDeviceLabel(device.label),
      version: normalizeDeviceVersion(device.version),
    }));
  } catch {
    return [];
  }
}

function persist(devices: DeviceVisit[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify({ devices }, null, 2), "utf8");
}

function byLastSeenDesc(a: DeviceVisit, b: DeviceVisit): number {
  if (a.lastSeen === b.lastSeen) return 0;
  return a.lastSeen < b.lastSeen ? 1 : -1;
}

export function summarizeDeviceLog(devices: DeviceVisit[], now = new Date()): DeviceLogSummary {
  const today = now.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
  const sorted = [...devices].sort(byLastSeenDesc);
  return {
    count: sorted.length,
    todayCount: sorted.filter((device) => zurichDay(device.lastSeen) === today).length,
    devices: sorted,
  };
}

export function getDeviceLog(): DeviceLogSummary {
  return summarizeDeviceLog(readDevices());
}

export function recordDeviceVisit(
  id: string,
  label: string,
  version = "",
  now = new Date(),
): DeviceLogSummary {
  const seenAt = now.toISOString();
  const devices = readDevices();
  const index = devices.findIndex((device) => device.id === id);
  if (index >= 0) {
    const current = devices[index];
    devices[index] = {
      ...current,
      label,
      version: version || current.version,
      lastSeen: seenAt,
      hits: current.hits + 1,
    };
  } else {
    devices.push({
      id,
      label,
      version,
      firstSeen: seenAt,
      lastSeen: seenAt,
      hits: 1,
    });
  }

  const kept = devices.sort(byLastSeenDesc).slice(0, MAX_TRACKED_DEVICES);
  persist(kept);
  return summarizeDeviceLog(kept, now);
}
