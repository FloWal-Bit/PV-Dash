import { NextResponse } from "next/server";
import { getMystromTarget } from "@/lib/dev-settings";
import { readMystromState, setMystromState } from "@/lib/mystrom";

export const dynamic = "force-dynamic";

function disabled() {
  return NextResponse.json(
    { error: "myStrom ist in den Dev-Einstellungen aus." },
    { status: 404 },
  );
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Lampe nicht erreichbar.";
  return NextResponse.json({ error: message }, { status: 502 });
}

export async function GET() {
  try {
    if (!getMystromTarget()) return disabled();
    return NextResponse.json(await readMystromState());
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!getMystromTarget()) return disabled();
  } catch (error) {
    return failure(error);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  const on =
    typeof body === "object" && body != null && "on" in body
      ? (body as { on: unknown }).on
      : undefined;
  if (typeof on !== "boolean") {
    return NextResponse.json({ error: "«on» muss true oder false sein." }, { status: 400 });
  }
  try {
    return NextResponse.json(await setMystromState(on));
  } catch (error) {
    return failure(error);
  }
}
