"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Clock, Clock3, CloudDrizzle, Cloudy, Sun, Sunrise, Sunset, SunDim } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSwissNumber } from "@/lib/format";
import { getSunInfo } from "@/lib/sun";
import { siteLocationStore } from "@/lib/site-location";
import { weatherStore } from "@/lib/weather-store";
import type { PvSnapshot } from "@/lib/pv-data";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatTimeWithSeconds(date: Date): string {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Live tickende Uhrzeit, sekundengenau – unabhängig vom Polling-Intervall der PV-Daten. */
function useCurrentTime(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return now;
}

function formatDayHeading(date: Date): string {
  return date.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

const weatherIcon: Record<PvSnapshot["weather"], ReactNode> = {
  sonnig: <Sun className="size-4" />,
  "leicht bewölkt": <SunDim className="size-4" />,
  bewölkt: <Cloudy className="size-4" />,
  regnerisch: <CloudDrizzle className="size-4" />,
};

function SunStat({
  icon,
  label,
  value,
  accent,
  valueClassName,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent: "amber" | "rose" | "green" | "slate";
  valueClassName?: string;
}) {
  const accentStyles: Record<typeof accent, string> = {
    amber: "from-chart-1/25 to-chart-1/5 text-chart-1",
    rose: "from-chart-5/25 to-chart-5/5 text-chart-5",
    green: "from-chart-3/25 to-chart-3/5 text-chart-3",
    slate: "from-muted to-muted/40 text-muted-foreground",
  };
  return (
    <div className="flex flex-col items-center gap-1.5 text-center transition-opacity">
      <div
        className={cn(
          "flex size-9 items-center justify-center rounded-2xl bg-gradient-to-br shadow-inner",
          accentStyles[accent],
        )}
      >
        {icon}
      </div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", valueClassName)}>{value}</span>
    </div>
  );
}

export function SunTimesCard({ date = new Date() }: { date?: Date }) {
  const { location } = useSyncExternalStore(
    siteLocationStore.subscribe,
    siteLocationStore.getSnapshot,
    siteLocationStore.getServerSnapshot,
  );
  const { data: waWeather, loading: waLoading } = useSyncExternalStore(
    weatherStore.subscribe,
    weatherStore.getSnapshot,
    weatherStore.getServerSnapshot,
  );
  const sunFallback = getSunInfo(date, location);
  const currentTime = useCurrentTime();

  useEffect(() => {
    void weatherStore.refresh(location.name);
  }, [location.name]);

  const weatherLabel = waWeather?.weatherLabel ?? "–";
  const weatherCategory = waWeather?.weatherCategory ?? "sonnig";
  const sunriseDisplay = waWeather?.sunrise ?? formatTime(sunFallback.sunrise);
  const sunsetDisplay = waWeather?.sunset ?? formatTime(sunFallback.sunset);
  const sunHoursDisplay = waWeather?.sunHours ?? sunFallback.forecastedSunHours;

  return (
    <Card className="shadow-card rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground capitalize">
          {formatDayHeading(date)}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-y-3 gap-x-1 px-4 py-3.5 sm:grid-cols-5 sm:gap-x-2">
        <SunStat
          icon={<Clock className="size-4" />}
          label="Uhrzeit"
          value={formatTimeWithSeconds(currentTime)}
          accent="slate"
        />
        <SunStat
          icon={weatherIcon[weatherCategory]}
          label="Wetter"
          value={waLoading && !waWeather ? "…" : weatherLabel}
          accent="slate"
          valueClassName="lowercase"
        />
        <SunStat
          icon={<Clock3 className="size-4" />}
          label="Sonnenstunden"
          value={
            waLoading && !waWeather
              ? "…"
              : `${formatSwissNumber(sunHoursDisplay, 1)} h`
          }
          accent="slate"
        />
        <SunStat
          icon={<Sunrise className="size-4" />}
          label="Sonnenaufgang"
          value={waLoading && !waWeather ? "…" : sunriseDisplay}
          accent="slate"
        />
        <SunStat
          icon={<Sunset className="size-4" />}
          label="Sonnenuntergang"
          value={waLoading && !waWeather ? "…" : sunsetDisplay}
          accent="slate"
        />
      </CardContent>
    </Card>
  );
}
