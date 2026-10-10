"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Clock,
  Clock3,
  CloudDrizzle,
  Cloudy,
  Sun,
  Sunrise,
  Sunset,
  SunDim,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SwipeCarousel } from "@/components/pv/swipe-carousel";
import { cn } from "@/lib/utils";
import { formatSwissNumber } from "@/lib/format";
import { weatherDateKey, weatherStore } from "@/lib/weather-store";
import type { PvSnapshot } from "@/lib/pv-data";

function formatTimeWithSeconds(date: Date): string {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

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

const WETTERALARM_URL = "https://app.wetteralarm.ch/V00A/m787crdw";

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
  unit,
  accent,
  valueClassName,
  href,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  accent: "amber" | "rose" | "green" | "slate";
  valueClassName?: string;
  href?: string;
}) {
  const accentStyles: Record<typeof accent, string> = {
    amber: "from-chart-1/25 to-chart-1/5 text-chart-1",
    rose: "from-chart-5/25 to-chart-5/5 text-chart-5",
    green: "from-chart-3/25 to-chart-3/5 text-chart-3",
    slate: "from-muted to-muted/40 text-muted-foreground",
  };
  return (
    <div className="flex flex-col items-center gap-1.5 text-center transition-opacity">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label} bei Wetter-Alarm öffnen`}
          className={cn(
            "flex size-9 items-center justify-center rounded-2xl bg-gradient-to-br shadow-inner transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            accentStyles[accent],
          )}
        >
          {icon}
        </a>
      ) : (
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-2xl bg-gradient-to-br shadow-inner",
            accentStyles[accent],
          )}
        >
          {icon}
        </div>
      )}
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex items-baseline justify-center gap-1">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums text-muted-foreground",
            valueClassName,
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-sm font-medium text-muted-foreground">{unit}</span>
        ) : null}
      </span>
    </div>
  );
}

function SunTimesDayCard({
  date,
  forecastedYieldKwh,
  showLiveClock,
}: {
  date: Date;
  forecastedYieldKwh: number | null;
  showLiveClock: boolean;
}) {
  const weatherState = useSyncExternalStore(
    weatherStore.subscribe,
    weatherStore.getSnapshot,
    weatherStore.getServerSnapshot,
  );
  const currentTime = useCurrentTime();
  const dateKey = weatherDateKey(date);
  const dayWeather = weatherState.byDate[dateKey] ?? null;

  const waLoading = weatherState.loading && dayWeather == null;
  const weatherLabel = dayWeather?.weatherLabel ?? "–";
  const weatherCategory = dayWeather?.weatherCategory ?? "sonnig";
  const sunriseDisplay = dayWeather?.sunrise ?? "–";
  const sunsetDisplay = dayWeather?.sunset ?? "–";
  const sunHoursDisplay =
    dayWeather?.sunHours != null ? dayWeather.sunHours : null;

  return (
    <Card className="shadow-card rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground capitalize">
          {formatDayHeading(date)}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-y-3 gap-x-1 px-4 py-3.5 sm:grid-cols-6 sm:gap-x-2">
        <SunStat
          icon={<Clock className="size-4" />}
          label="Uhrzeit"
          value={showLiveClock ? formatTimeWithSeconds(currentTime) : "–"}
          accent="slate"
        />
        <SunStat
          icon={weatherIcon[weatherCategory]}
          label="Wetter"
          href={WETTERALARM_URL}
          value={waLoading && !dayWeather ? "…" : weatherLabel}
          accent="slate"
          valueClassName="lowercase"
        />
        <SunStat
          icon={<Clock3 className="size-4" />}
          label="Sonnenstunden"
          value={
            waLoading ? "…" : sunHoursDisplay != null ? formatSwissNumber(sunHoursDisplay, 1) : "–"
          }
          unit={!waLoading && sunHoursDisplay != null ? "h" : undefined}
          accent="slate"
        />
        <SunStat
          icon={<Sunrise className="size-4" />}
          label="Sonnenaufgang"
          value={waLoading && !dayWeather ? "…" : sunriseDisplay}
          accent="slate"
        />
        <SunStat
          icon={<Sunset className="size-4" />}
          label="Sonnenuntergang"
          value={waLoading && !dayWeather ? "…" : sunsetDisplay}
          accent="slate"
        />
        <SunStat
          icon={<Zap className="size-4" />}
          label="Ertragsprognose"
          value={
            forecastedYieldKwh != null ? formatSwissNumber(forecastedYieldKwh, 1) : "–"
          }
          unit={forecastedYieldKwh != null ? "kWh" : undefined}
          accent="slate"
        />
      </CardContent>
    </Card>
  );
}

export function SunTimesCard({
  referenceDate = new Date(),
  forecastedTodayYieldKwh = null,
  forecastedTomorrowYieldKwh = null,
  className,
}: {
  referenceDate?: Date;
  forecastedTodayYieldKwh?: number | null;
  forecastedTomorrowYieldKwh?: number | null;
  className?: string;
}) {
  const tomorrowDate = useMemo(() => {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 1);
    return d;
  }, [referenceDate]);

  return (
    <SwipeCarousel labels={["Heute", "Morgen"]} className={cn("min-w-0 gap-1", className)}>
      <SunTimesDayCard
        date={referenceDate}
        forecastedYieldKwh={forecastedTodayYieldKwh}
        showLiveClock
      />
      <SunTimesDayCard
        date={tomorrowDate}
        forecastedYieldKwh={forecastedTomorrowYieldKwh}
        showLiveClock={false}
      />
    </SwipeCarousel>
  );
}
