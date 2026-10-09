import { NextResponse } from "next/server";
import { parseStromkontoBalanceInput } from "@/lib/stromkonto-shared";
import {
  getStromkontoBaseBalance,
  getStromkontoTodayChange,
  setStromkontoBaseBalance,
  setStromkontoTodayChange,
} from "@/lib/stromkonto";
import { getLatestWhatWattMeterTotals } from "@/lib/whatwatt/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    balanceKwh: getStromkontoBaseBalance(),
    todayChangeKwh: getStromkontoTodayChange(),
  });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  if (typeof body === "object" && body !== null && "todayChangeKwh" in body) {
    const todayRaw = String((body as { todayChangeKwh: unknown }).todayChangeKwh);
    const todayChangeKwh = parseStromkontoBalanceInput(todayRaw);
    if (todayChangeKwh == null) {
      return NextResponse.json(
        { error: "Bitte einen gültigen Tageswert in kWh angeben." },
        { status: 400 },
      );
    }

    const meterTotals = getLatestWhatWattMeterTotals();
    setStromkontoTodayChange(todayChangeKwh, meterTotals ?? undefined);
    return NextResponse.json({
      todayChangeKwh,
      anchored: meterTotals != null,
    });
  }

  const raw =
    typeof body === "object" && body !== null && "balanceKwh" in body
      ? String((body as { balanceKwh: unknown }).balanceKwh)
      : "";

  const balanceKwh = parseStromkontoBalanceInput(raw);
  if (balanceKwh == null) {
    return NextResponse.json({ error: "Bitte einen gültigen kWh-Wert angeben." }, { status: 400 });
  }

  const meterTotals = getLatestWhatWattMeterTotals();
  setStromkontoBaseBalance(balanceKwh, meterTotals ?? undefined);

  return NextResponse.json({
    balanceKwh,
    reAnchored: meterTotals != null,
  });
}
