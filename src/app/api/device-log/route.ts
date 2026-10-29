import { NextResponse } from "next/server";
import { getDeviceLog, recordDeviceVisit } from "@/lib/device-log";
import {
  isDeviceId,
  normalizeDeviceLabel,
  normalizeDeviceVersion,
} from "@/lib/device-log-shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getDeviceLog());
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  const payload = body as { id?: unknown; label?: unknown; version?: unknown };
  if (!isDeviceId(payload.id)) {
    return NextResponse.json({ error: "Ungültige Gerätekennung." }, { status: 400 });
  }

  const label = normalizeDeviceLabel(payload.label);
  const version = normalizeDeviceVersion(payload.version);
  return NextResponse.json(recordDeviceVisit(payload.id, label, version));
}
