"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Clock,
  CloudDrizzle,
  Cloudy,
  Sun,
  SunDim,
  Thermometer,
  Timer,
  Zap,
  createLucideIcon,
} from "lucide-react";

/**
 * Sonnenaufgang-Icon ohne den Pfeil. An seiner Stelle ein Strahl,
 * gleich lang wie die übrigen Strahlen (Länge 2 im 24er-Raster).
 */
const SunCourse = createLucideIcon("sun-course", [
  ["path", { d: "M12 8v2" }],
  ["path", { d: "m4.93 10.93 1.41 1.41" }],
  ["path", { d: "M2 18h2" }],
  ["path", { d: "M20 18h2" }],
  ["path", { d: "m19.07 10.93-1.41 1.41" }],
  ["path", { d: "M22 22H2" }],
  ["path", { d: "M16 18a4 4 0 0 0-8 0" }],
]);
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SwipeCarousel } from "@/components/pv/swipe-carousel";
import { cn } from "@/lib/utils";
import { formatSwissNumber } from "@/lib/format";
import { weatherDateKey, weatherStore } from "@/lib/weather-store";
import type { PvSnapshot } from "@/lib/pv-data";
import {
  addZurichDaysKey,
  dateForZurichDayKey,
  zurichDayKey,
} from "@/lib/server-pause-window";
import { APP_TIME_ZONE } from "@/lib/daily-checkpoint";

function formatCelsius(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const digits = Number.isInteger(rounded) ? 0 : 1;
  return `${formatSwissNumber(rounded, digits)}°`;
}

export function formatTimeWithSeconds(date: Date): string {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Aktuelle Uhrzeit. Nach dem Aufwachen (Bildschirm an, PWA aus dem Cache)
 * sofort nachziehen — ein eingefrorener Timer würde sonst den gestrigen Tag stehen lassen.
 */
export function useCurrentTime(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = setInterval(tick, 1000);
    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      tick();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return now;
}

function formatDayHeading(date: Date): string {
  return date.toLocaleDateString("de-DE", {
    timeZone: APP_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Ertragsprognose der Slides am Kalendertag ausrichten.
 * Liegt der letzte Snapshot noch auf gestern, rutschen die Werte um einen Tag nach vorn.
 */
function yieldsForCalendarDay(
  now: Date,
  snapshotTimestamp: number | null,
  forecastedTodayYieldKwh: number | null,
  forecastedTomorrowYieldKwh: number | null,
  forecastedDayAfterTomorrowYieldKwh: number | null,
): { today: number | null; tomorrow: number | null; dayAfterTomorrow: number | null } {
  const aligned = {
    today: forecastedTodayYieldKwh,
    tomorrow: forecastedTomorrowYieldKwh,
    dayAfterTomorrow: forecastedDayAfterTomorrowYieldKwh,
  };
  if (snapshotTimestamp == null) return aligned;
  const todayKey = zurichDayKey(now.getTime());
  const snapshotKey = zurichDayKey(snapshotTimestamp);
  if (snapshotKey === todayKey) return aligned;
  if (addZurichDaysKey(snapshotKey, 1) === todayKey) {
    return {
      today: forecastedTomorrowYieldKwh,
      tomorrow: forecastedDayAfterTomorrowYieldKwh,
      dayAfterTomorrow: null,
    };
  }
  return { today: null, tomorrow: null, dayAfterTomorrow: null };
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
  className,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  accent: "amber" | "rose" | "green" | "slate";
  valueClassName?: string;
  href?: string;
  className?: string;
}) {
  const accentStyles: Record<typeof accent, string> = {
    amber: "from-chart-1/25 to-chart-1/5 text-chart-1",
    rose: "from-chart-5/25 to-chart-5/5 text-chart-5",
    green: "from-chart-3/25 to-chart-3/5 text-chart-3",
    slate: "from-muted to-muted/40 text-muted-foreground",
  };
  return (
    <div className={cn("flex flex-col items-center gap-1.5 text-center transition-opacity", className)}>
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
            "text-sm font-semibold tabular-nums text-card-foreground",
            valueClassName,
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-sm font-medium text-card-foreground">{unit}</span>
        ) : null}
      </span>
    </div>
  );
}

function SunTimesDayCard({
  date,
  forecastedYieldKwh,
}: {
  date: Date;
  forecastedYieldKwh: number | null;
}) {
  const weatherState = useSyncExternalStore(
    weatherStore.subscribe,
    weatherStore.getSnapshot,
    weatherStore.getServerSnapshot,
  );
  const dateKey = weatherDateKey(date);
  const dayWeather = weatherState.byDate[dateKey] ?? null;

  const waLoading = weatherState.loading && dayWeather == null;
  const weatherLabel = dayWeather?.weatherLabel ?? "–";
  const weatherCategory = dayWeather?.weatherCategory ?? "sonnig";
  const sunriseDisplay = dayWeather?.sunrise ?? "–";
  const sunsetDisplay = dayWeather?.sunset ?? "–";
  const temperatureDisplay =
    typeof dayWeather?.temperatureMin === "number" &&
    Number.isFinite(dayWeather.temperatureMin) &&
    typeof dayWeather.temperatureMax === "number" &&
    Number.isFinite(dayWeather.temperatureMax)
      ? `${formatCelsius(dayWeather.temperatureMin)} / ${formatCelsius(dayWeather.temperatureMax)}`
      : "–";
  const sunHoursDisplay =
    dayWeather?.sunHours != null ? dayWeather.sunHours : null;

  return (
    <>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-card-foreground capitalize">
          {formatDayHeading(date)}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-6 gap-y-3 gap-x-1 px-4 py-3.5 sm:grid-cols-5 sm:gap-x-2">
        <SunStat
          className="col-span-2 sm:col-span-1"
          icon={weatherIcon[weatherCategory]}
          label="Wetter"
          href={WETTERALARM_URL}
          value={waLoading && !dayWeather ? "…" : weatherLabel}
          accent="slate"
        />
        <SunStat
          className="col-span-2 sm:col-span-1"
          icon={<Thermometer className="size-4" />}
          label="Temperatur"
          value={waLoading && !dayWeather ? "…" : temperatureDisplay}
          valueClassName="whitespace-nowrap"
          accent="slate"
        />
        <SunStat
          className="col-span-2 sm:col-span-1"
          icon={<Zap className="size-4" />}
          label="Ertragsprognose"
          value={
            forecastedYieldKwh != null ? formatSwissNumber(forecastedYieldKwh, 1) : "–"
          }
          unit={forecastedYieldKwh != null ? "kWh" : undefined}
          accent="slate"
        />
        <SunStat
          className="col-span-2 col-start-2 sm:col-span-1 sm:col-start-auto"
          icon={<Timer className="size-4" />}
          label="Sonnenstunden"
          value={
            waLoading ? "…" : sunHoursDisplay != null ? formatSwissNumber(sunHoursDisplay, 1) : "–"
          }
          unit={!waLoading && sunHoursDisplay != null ? "h" : undefined}
          accent="slate"
        />
        <SunStat
          className="col-span-2 col-start-4 sm:col-span-1 sm:col-start-auto"
          icon={<SunCourse className="size-4" />}
          label="Sonnenverlauf"
          value={
            waLoading && !dayWeather ? "…" : `${sunriseDisplay} / ${sunsetDisplay}`
          }
          valueClassName="whitespace-nowrap"
          accent="slate"
        />
      </CardContent>
    </>
  );
}

/** Aktuelle Uhrzeit. Icon und Text liegen auf derselben Höhe wie in der Wetterkarte. */
export function ClockCard({ className }: { className?: string }) {
  const now = useCurrentTime();
  return (
    <Card className={cn("shadow-card h-full justify-start gap-0 rounded-2xl py-4", className)}>
      <div className="flex flex-col">
        <CardHeader aria-hidden className="invisible">
          <CardTitle className="text-sm font-medium capitalize">&nbsp;</CardTitle>
        </CardHeader>
        <CardContent className="grid px-4 py-3.5">
          <SunStat
            icon={<Clock className="size-4" />}
            label="Uhrzeit"
            value={formatTimeWithSeconds(now)}
            valueClassName="whitespace-nowrap"
            accent="slate"
          />
        </CardContent>
      </div>
    </Card>
  );
}

export function SunTimesCard({
  snapshotTimestamp = null,
  forecastedTodayYieldKwh = null,
  forecastedTomorrowYieldKwh = null,
  forecastedDayAfterTomorrowYieldKwh = null,
  className,
}: {
  /** Messzeitpunkt. Bestimmt nicht die Tagesüberschrift — die folgt der Uhr in Europe/Zurich. */
  snapshotTimestamp?: number | null;
  forecastedTodayYieldKwh?: number | null;
  forecastedTomorrowYieldKwh?: number | null;
  forecastedDayAfterTomorrowYieldKwh?: number | null;
  className?: string;
}) {
  const now = useCurrentTime();
  const todayKey = zurichDayKey(now.getTime());
  const todayDate = useMemo(() => dateForZurichDayKey(todayKey), [todayKey]);
  const tomorrowDate = useMemo(
    () => dateForZurichDayKey(addZurichDaysKey(todayKey, 1)),
    [todayKey],
  );
  const dayAfterTomorrowDate = useMemo(
    () => dateForZurichDayKey(addZurichDaysKey(todayKey, 2)),
    [todayKey],
  );
  const yields = yieldsForCalendarDay(
    now,
    snapshotTimestamp,
    forecastedTodayYieldKwh,
    forecastedTomorrowYieldKwh,
    forecastedDayAfterTomorrowYieldKwh,
  );

  return (
    <Card data-sun-times-card className={cn("shadow-card rounded-2xl", className)}>
      <SwipeCarousel labels={["Heute", "Morgen", "Übermorgen"]} className="min-w-0 gap-3 pb-1">
        <SunTimesDayCard date={todayDate} forecastedYieldKwh={yields.today} />
        <SunTimesDayCard date={tomorrowDate} forecastedYieldKwh={yields.tomorrow} />
        <SunTimesDayCard
          date={dayAfterTomorrowDate}
          forecastedYieldKwh={yields.dayAfterTomorrow}
        />
      </SwipeCarousel>
    </Card>
  );
}
