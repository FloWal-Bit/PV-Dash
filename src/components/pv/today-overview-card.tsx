"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SIMULATED_OPACITY_CLASS, isPvSimulated } from "@/lib/data-fidelity";
import { financialAutarkyRate } from "@/lib/autarky";
import type { PvSnapshot } from "@/lib/pv-data";
import type { DataSource } from "@/lib/pv-source";
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
}: {
  snapshot: PvSnapshot;
  source: DataSource;
}) {
  const pvSimulated = isPvSimulated(source);
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
          valueDisplay={snapshot.autarkyRate != null ? `${snapshot.autarkyRate} %` : "–"}
        />
        <MetricRow
          label="Finanzieller Autarkiegrad"
          value={financialAutarky ?? 0}
          valueDisplay={financialAutarky != null ? `${financialAutarky} %` : "–"}
        />
      </CardContent>
    </Card>
  );
}
