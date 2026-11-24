import { NextResponse } from "next/server";
import { getSharedDevSettings, updateSharedDevSettings } from "@/lib/dev-settings";
import type { DevSettingsUpdate } from "@/lib/dev-settings-shared";
import { presentDevSettings, requestHasControlDevice, updateTouchesControlCards } from "@/lib/control-device";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unlocked = requestHasControlDevice(request);
  return NextResponse.json(presentDevSettings(getSharedDevSettings(), unlocked));
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
  const unlocked = requestHasControlDevice(request);
  if (updateTouchesControlCards(update) && !unlocked) {
    return NextResponse.json(
      { error: "Nur das freigegebene Gerät kann Lampe und Spotify ändern." },
      { status: 401 },
    );
  }
  try {
    return NextResponse.json(presentDevSettings(updateSharedDevSettings(update), unlocked));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speichern fehlgeschlagen.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
