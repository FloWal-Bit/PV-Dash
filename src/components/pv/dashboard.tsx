"use client";

import { useEffect, useSyncExternalStore } from "react";
import { RefreshCcw } from "lucide-react";
import { DashboardHeader } from "@/components/pv/header";
import { KpiGrid } from "@/components/pv/kpi-grid";
import { EnergyFlow } from "@/components/pv/energy-flow";
import { TodayOverviewCard } from "@/components/pv/today-overview-card";
import { SunTimesCard } from "@/components/pv/sun-times-card";
import { ChartsSection } from "@/components/pv/charts-section";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { pvStore } from "@/lib/pv-store";
import { siteLocationStore } from "@/lib/site-location";
import { weatherStore } from "@/lib/weather-store";
import { checkYieldNotification } from "@/lib/notifications";
import { APP_NAME, APP_VERSION_LABEL } from "@/lib/version";

export function Dashboard({ plantName }: { plantName: string }) {
  const {
    data,
    error,
    source,
    gridSource,
    forecastedTodayYieldKwh,
    forecastedTomorrowYieldKwh,
    forecastSolarError,
    warning,
    lastFetchedAt,
  } = useSyncExternalStore(pvStore.subscribe, pvStore.getSnapshot, pvStore.getServerSnapshot);
  const { location } = useSyncExternalStore(
    siteLocationStore.subscribe,
    siteLocationStore.getSnapshot,
    siteLocationStore.getServerSnapshot,
  );
  const {
    error: weatherError,
    loading: weatherLoading,
  } = useSyncExternalStore(
    weatherStore.subscribe,
    weatherStore.getSnapshot,
    weatherStore.getServerSnapshot,
  );
  const lastUpdated = lastFetchedAt != null ? new Date(lastFetchedAt) : null;
  const dataSource = source ?? "simulation";
  const externalServiceErrors = [
    !weatherLoading && weatherError ? weatherError : null,
    forecastSolarError,
  ].filter((message): message is string => message != null);

  useEffect(() => {
    void weatherStore.refresh(location.name);
  }, [location.name]);

  useEffect(() => {
    if (!data) return;
    checkYieldNotification(data.snapshot.todayYieldKwh, data.snapshot.timestamp);
  }, [data]);

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_50%_at_50%_-10%,color-mix(in_oklch,var(--color-primary)_16%,transparent),transparent_70%)]"
      />

      <DashboardHeader
        lastUpdated={lastUpdated}
        plantName={plantName}
        source={source}
        gridSource={gridSource}
      />

      <main className="dashboard-container safe-bottom flex w-full flex-1 flex-col gap-4 py-4 sm:py-6">
        {error ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{error}</span>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={pvStore.refresh}
            >
              <RefreshCcw className="size-3.5" />
              Erneut versuchen
            </Button>
          </div>
        ) : null}

        {!error && warning ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            {warning}
          </div>
        ) : null}

        {externalServiceErrors.length > 0 ? (
          <div
            className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
            role="status"
          >
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {externalServiceErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!data ? (
          <DashboardSkeleton />
        ) : (
          <>
            <SunTimesCard
              className="min-w-0"
              referenceDate={new Date(data.snapshot.timestamp)}
              forecastedTodayYieldKwh={forecastedTodayYieldKwh}
              forecastedTomorrowYieldKwh={forecastedTomorrowYieldKwh}
            />

            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
              <EnergyFlow
                className="min-w-0 md:col-start-1"
                snapshot={data.snapshot}
                source={dataSource}
                gridSource={gridSource}
              />
              <KpiGrid
                className="min-w-0 md:col-start-2 md:grid-cols-2 md:content-start"
                snapshot={data.snapshot}
                source={dataSource}
                gridSource={gridSource}
              />
            </div>

            <TodayOverviewCard snapshot={data.snapshot} source={dataSource} />

            <ChartsSection
              today={data.today}
              week={data.week}
              month={data.month}
              year={data.year}
              lifetime={data.lifetime}
              source={dataSource}
            />
          </>
        )}
      </main>

      <footer className="dashboard-container safe-bottom flex w-full items-center justify-between gap-3 pb-4 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {source === "fusionsolar"
            ? "Live-Daten von FusionSolar"
            : "Simulierte Anlagendaten"}
          {gridSource === "whatwatt" ? " · Netzwerte von whatwatt Go" : ""}
        </span>
        <span className="shrink-0 tabular-nums">
          {APP_NAME} {APP_VERSION_LABEL}
        </span>
      </footer>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[120px] rounded-2xl" />
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-56 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[96px] rounded-2xl" />
          ))}
        </div>
      </div>
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
