import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { SIMULATED_OPACITY_CLASS } from "@/lib/data-fidelity";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: ReactNode;
  value: string;
  unit?: string;
  hint?: string;
  icon: ReactNode;
  accent?: "amber" | "green" | "rose";
  simulated?: boolean;
  valueClassName?: string;
  className?: string;
};

const accentStyles: Record<NonNullable<StatCardProps["accent"]>, string> = {
  amber: "from-chart-1/25 to-chart-1/5 text-chart-1",
  green: "from-chart-3/25 to-chart-3/5 text-chart-3",
  rose: "from-chart-5/25 to-chart-5/5 text-chart-5",
};

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  accent = "amber",
  simulated = false,
  valueClassName,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("shadow-card h-full justify-center gap-3 rounded-2xl py-4", className)}>
      <CardContent className="flex flex-col gap-1 px-4">
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 min-w-0 text-xs leading-tight font-medium text-muted-foreground">
            {label}
          </span>
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br transition-opacity",
              accentStyles[accent],
              simulated && SIMULATED_OPACITY_CLASS,
            )}
          >
            {icon}
          </div>
        </div>
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1 transition-opacity",
            simulated && SIMULATED_OPACITY_CLASS,
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-1">
            <span
              className={cn(
                "text-[1.75rem] font-semibold tracking-tight tabular-nums",
                valueClassName,
              )}
            >
              {value}
            </span>
            {unit ? (
              <span className="text-sm font-medium text-muted-foreground">{unit}</span>
            ) : null}
          </div>
          {hint ? (
            <span className="truncate text-xs text-muted-foreground">{hint}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
