import { NextResponse } from "next/server";
import { isValidSwissPlz, lookupPlzLocalities } from "@/lib/ch-plz";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const zip = new URL(request.url).searchParams.get("zip")?.trim() ?? "";

  if (!isValidSwissPlz(zip)) {
    return NextResponse.json(
      { error: "Bitte eine vierstellige Schweizer PLZ eingeben." },
      { status: 400 },
    );
  }

  const localities = lookupPlzLocalities(zip);
  if (localities.length === 0) {
    return NextResponse.json({ error: `Keine Orte für PLZ ${zip} gefunden.` }, { status: 404 });
  }

  return NextResponse.json({ plz: zip, localities });
}
