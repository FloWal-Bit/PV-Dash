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
  className,
}: StatCardProps) {
  return (
    <Card className={cn("shadow-card gap-3 rounded-2xl py-4", className)}>
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1 transition-opacity",
            simulated && SIMULATED_OPACITY_CLASS,
          )}
        >
          <span className="line-clamp-2 text-xs leading-tight font-medium text-muted-foreground">
            {label}
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-[1.75rem] font-semibold tracking-tight tabular-nums">
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
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br transition-opacity",
            accentStyles[accent],
            simulated && SIMULATED_OPACITY_CLASS,
          )}
        >
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
