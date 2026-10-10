import { NextResponse } from "next/server";
import { getLiveDashboardPayload } from "@/lib/pv-source";

// Nie statisch cachen: Wir wollen bei jedem Aufruf durch unsere eigene,
// ratenlimit-bewusste Caching-Schicht in `pv-source`/`fusionsolar/service`
// laufen, nicht durch Next.js' Route-Cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getLiveDashboardPayload();
  return NextResponse.json(payload);
}
