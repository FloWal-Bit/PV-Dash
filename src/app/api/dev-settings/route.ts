import { NextResponse } from "next/server";
import { getSharedDevSettings, updateSharedDevSettings } from "@/lib/dev-settings";
import type { DevSettingsUpdate } from "@/lib/dev-settings-shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSharedDevSettings());
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  const update = body as DevSettingsUpdate;
  try {
    return NextResponse.json(updateSharedDevSettings(update));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speichern fehlgeschlagen.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
