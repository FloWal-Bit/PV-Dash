"use client";

import { useSyncExternalStore } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SIMULATED_OPACITY_CLASS, isPvSimulated } from "@/lib/data-fidelity";
import type { DailyEnergyPoint, PvSnapshot } from "@/lib/pv-data";
import type { DataSource } from "@/lib/pv-source";
import { siteLocationStore } from "@/lib/site-location";
import { estimateForecastedYieldKwh, getSunInfo } from "@/lib/sun";
import { formatYieldKwh } from "@/lib/format";
import { cn } from "@/lib/utils";

function sumYieldKwh(points: DailyEnergyPoint[]): number {
  return points.reduce((sum, point) => sum + point.yieldKwh, 0);
}

export function MetricsCard({
  snapshot,
  source,
  month,
  year,
}: {
  snapshot: PvSnapshot;
  source: DataSource;
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}) {
  const pvSimulated = isPvSimulated(source);
  const { location } = useSyncExternalStore(
    siteLocationStore.subscribe,
    siteLocationStore.getSnapshot,
    siteLocationStore.getServerSnapshot,
  );
  const sunInfo = getSunInfo(new Date(snapshot.timestamp), location);
  const forecastedTodayYieldKwh = estimateForecastedYieldKwh(snapshot.systemPeakKwp, sunInfo);
  const forecastProgress =
    forecastedTodayYieldKwh > 0
      ? Math.min(100, Math.round((snapshot.todayYieldKwh / forecastedTodayYieldKwh) * 100))
      : 0;

  return (
    <Card className="shadow-card rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Kennzahlen
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn("flex flex-col gap-4 transition-opacity", pvSimulated && SIMULATED_OPACITY_CLASS)}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-sm">
            <span>Eigenverbrauchsquote</span>
            <span className="font-medium tabular-nums">
              {snapshot.selfConsumptionRate != null
                ? `${snapshot.selfConsumptionRate}%`
                : "–"}
            </span>
          </div>
          <Progress
            value={snapshot.selfConsumptionRate ?? 0}
            className="[&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-chart-1/70 [&_[data-slot=progress-indicator]]:to-chart-1 [&_[data-slot=progress-track]]:h-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-sm">
            <span>Prognostizierter Tagesertrag</span>
            <span className="font-medium tabular-nums">
              {snapshot.todayYieldKwh.toFixed(1)} / {forecastedTodayYieldKwh.toFixed(1)} kWh
            </span>
          </div>
          <Progress
            value={forecastProgress}
            className="[&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-chart-3/70 [&_[data-slot=progress-indicator]]:to-chart-3 [&_[data-slot=progress-track]]:h-2"
          />
        </div>

        <div className="mt-1 flex flex-col gap-2.5 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ertrag dieser Monat</span>
            <span className="text-sm font-semibold tabular-nums">
              {month.length ? formatYieldKwh(sumYieldKwh(month), 1) : "–"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ertrag dieses Jahr</span>
            <span className="text-sm font-semibold tabular-nums">
              {year.length ? formatYieldKwh(sumYieldKwh(year), 0) : "–"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ertrag seit Inbetriebnahme</span>
            <span className="text-sm font-semibold tabular-nums">
              {formatYieldKwh(snapshot.totalYieldKwh, 0)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
