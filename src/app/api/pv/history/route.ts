import { NextResponse } from "next/server";
import { getHistoryPayload } from "@/lib/pv-source";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const fusionLive = new URL(request.url).searchParams.get("fusionLive") === "1";
    const payload = await getHistoryPayload({ fusionLive });
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    console.error("[pv] Verlaufsdaten nicht verfügbar:", message);
    return NextResponse.json(
      { error: "Verlaufsdaten konnten nicht geladen werden." },
      { status: 500 },
    );
  }
}
