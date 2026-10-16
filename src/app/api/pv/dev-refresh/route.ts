import { NextResponse } from "next/server";
import { refreshFusionSolarDevCache } from "@/lib/pv-source";

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Nur in der lokalen Entwicklung." }, { status: 404 });
  }

  const result = await refreshFusionSolarDevCache();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
