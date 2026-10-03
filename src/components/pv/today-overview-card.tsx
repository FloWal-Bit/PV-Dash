"use client";

import { useSyncExternalStore } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SIMULATED_OPACITY_CLASS, isPvSimulated } from "@/lib/data-fidelity";
import { financialAutarkyRate } from "@/lib/autarky";
import { formatSwissNumber } from "@/lib/format";
import type { PvSnapshot } from "@/lib/pv-data";
import type { DataSource } from "@/lib/pv-source";
import { estimateForecastedYieldKwh, getSunInfo, type SunInfo } from "@/lib/sun";
import { siteLocationStore } from "@/lib/site-location";
import { weatherStore } from "@/lib/weather-store";
import { cn } from "@/lib/utils";

const GREEN_PROGRESS =
  "[&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-chart-3/70 [&_[data-slot=progress-indicator]]:to-chart-3 [&_[data-slot=progress-track]]:h-2";

function MetricRow({
  label,
  value,
  valueDisplay,
}: {
  label: string;
  value: number;
  valueDisplay?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium tabular-nums">{valueDisplay ?? `${value}%`}</span>
      </div>
      <Progress value={value} className={GREEN_PROGRESS} />
    </div>
  );
}

export function TodayOverviewCard({
  snapshot,
  source,
  forecastedTodayYieldKwh,
}: {
  snapshot: PvSnapshot;
  source: DataSource;
  forecastedTodayYieldKwh: number | null;
}) {
  const pvSimulated = isPvSimulated(source);
  const { location } = useSyncExternalStore(
    siteLocationStore.subscribe,
    siteLocationStore.getSnapshot,
    siteLocationStore.getServerSnapshot,
  );
  const { data: waWeather } = useSyncExternalStore(
    weatherStore.subscribe,
    weatherStore.getSnapshot,
    weatherStore.getServerSnapshot,
  );
  const baseSunInfo = getSunInfo(new Date(snapshot.timestamp), location);
  const sunInfo: SunInfo = waWeather
    ? { ...baseSunInfo, forecastedSunHours: waWeather.sunHours }
    : baseSunInfo;
  const forecastKwh =
    forecastedTodayYieldKwh ??
    estimateForecastedYieldKwh(snapshot.systemPeakKwp, sunInfo);
  const forecastProgress =
    forecastKwh > 0
      ? Math.min(100, Math.round((snapshot.todayYieldKwh / forecastKwh) * 100))
      : 0;
  const financialAutarky = financialAutarkyRate(snapshot);

  return (
    <Card className="shadow-card rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Heute</CardTitle>
      </CardHeader>
      <CardContent
        className={cn("flex flex-col gap-4 transition-opacity", pvSimulated && SIMULATED_OPACITY_CLASS)}
      >
        <MetricRow
          label="Physischer Autarkiegrad"
          value={snapshot.autarkyRate ?? 0}
          valueDisplay={
            snapshot.autarkyRate != null ? `${snapshot.autarkyRate}%` : "–"
          }
        />
        <MetricRow
          label="Finanzieller Autarkiegrad"
          value={financialAutarky ?? 0}
          valueDisplay={financialAutarky != null ? `${financialAutarky}%` : "–"}
        />
        <MetricRow
          label="Prognostizierter Tagesertrag"
          value={forecastProgress}
          valueDisplay={`${formatSwissNumber(snapshot.todayYieldKwh, 1)} / ${formatSwissNumber(forecastKwh, 1)} kWh`}
        />
      </CardContent>
    </Card>
  );
}
