import { NextResponse } from "next/server";
import { getDeviceLog, recordDeviceVisit } from "@/lib/device-log";
import { isDeviceId, normalizeDeviceLabel } from "@/lib/device-log-shared";

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

  const { id } = body as { id?: unknown };
  if (!isDeviceId(id)) {
    return NextResponse.json({ error: "Ungültige Gerätekennung." }, { status: 400 });
  }

  const label = normalizeDeviceLabel((body as { label?: unknown }).label);
  return NextResponse.json(recordDeviceVisit(id, label));
}
