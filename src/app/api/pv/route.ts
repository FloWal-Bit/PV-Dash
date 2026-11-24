import { NextResponse } from "next/server";
import { presentDevSettings, requestHasControlDevice } from "@/lib/control-device";
import { getLiveDashboardPayload } from "@/lib/pv-source";

// Nie statisch cachen: Wir wollen bei jedem Aufruf durch unsere eigene,
// ratenlimit-bewusste Caching-Schicht in `pv-source`/`fusionsolar/service`
// laufen, nicht durch Next.js' Route-Cache.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const payload = await getLiveDashboardPayload();
  return NextResponse.json({
    ...payload,
    devSettings: presentDevSettings(payload.devSettings, requestHasControlDevice(request)),
  });
}
