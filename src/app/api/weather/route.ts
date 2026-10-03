import { NextResponse } from "next/server";
import {
  getWetterAlarmDailyWeather,
  weatherCategoryFromLabel,
} from "@/lib/wetteralarm/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location")?.trim();
  const dateParam = searchParams.get("date")?.trim();

  let date: Date | undefined;
  if (dateParam) {
    const parsed = new Date(`${dateParam}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  try {
    const weather = await getWetterAlarmDailyWeather({ locationName: location, date });
    return NextResponse.json({
      ...weather,
      weatherCategory: weatherCategoryFromLabel(weather.weatherLabel),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Wetterdaten konnten nicht geladen werden";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
