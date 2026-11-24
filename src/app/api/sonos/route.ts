import { NextResponse } from "next/server";
import { getSonosTarget, requestMayUseCards } from "@/lib/dev-settings";
import { controlSonos, readSonosNow, type SonosAction } from "@/lib/sonos";

export const dynamic = "force-dynamic";

const ACTIONS = new Set<SonosAction>(["play", "pause", "next", "previous"]);

function locked() {
  return NextResponse.json(
    { error: "Dieses Gerät ist für Sonos nicht freigegeben." },
    { status: 401 },
  );
}

function disabled() {
  return NextResponse.json(
    { error: "Sonos ist in den Dev-Einstellungen aus." },
    { status: 404 },
  );
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Sonos nicht erreichbar.";
  return NextResponse.json({ error: message }, { status: 502 });
}

export async function GET(request: Request) {
  if (!requestMayUseCards(request)) return locked();
  try {
    if (!getSonosTarget()) return disabled();
    return NextResponse.json(await readSonosNow());
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!requestMayUseCards(request)) return locked();
  try {
    if (!getSonosTarget()) return disabled();
  } catch (error) {
    return failure(error);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  const action =
    typeof body === "object" && body != null && "action" in body
      ? (body as { action: unknown }).action
      : undefined;
  if (typeof action !== "string" || !ACTIONS.has(action as SonosAction)) {
    return NextResponse.json(
      { error: "«action» muss play, pause, next oder previous sein." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await controlSonos(action as SonosAction));
  } catch (error) {
    return failure(error);
  }
}
