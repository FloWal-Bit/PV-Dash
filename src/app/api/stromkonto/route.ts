import { NextResponse } from "next/server";
import { parseStromkontoBalanceInput } from "@/lib/stromkonto-shared";
import {
  getStromkontoBaseBalance,
  getStromkontoTodayChange,
  setStromkontoBaseBalance,
  setStromkontoTodayChange,
} from "@/lib/stromkonto";
import { getAboEndForecast } from "@/lib/stromkonto-abo-end-forecast";
import { getLatestWhatWattMeterTotals } from "@/lib/whatwatt/service";
import { getHistoryPayload, getLiveDashboardPayload } from "@/lib/pv-source";

export const dynamic = "force-dynamic";

export async function GET() {
  const balanceKwh = getStromkontoBaseBalance();
  const todayChangeKwh = getStromkontoTodayChange();

  let aboEndForecast = null;
  try {
    const [live, history] = await Promise.all([getLiveDashboardPayload(), getHistoryPayload()]);
    const currentBalanceKwh = live.snapshot.stromkontoBalanceKwh ?? balanceKwh;
    aboEndForecast = getAboEndForecast({
      currentBalanceKwh,
      yearMonths: history.year,
      monthDays: history.month,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    console.error("[stromkonto] Abo-Ende-Prognose fehlgeschlagen:", message);
  }

  return NextResponse.json({
    balanceKwh,
    todayChangeKwh,
    aboEndForecast,
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
