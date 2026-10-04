"use client";

import { Radio, Sun } from "lucide-react";
import { ShareDashboardButton } from "@/components/pv/share-dashboard-button";
import { ThemeToggle } from "@/components/pv/theme-toggle";
import { BacklogDialog } from "@/components/pv/backlog-dialog";
import { SettingsDialog } from "@/components/pv/settings-dialog";
import { cn } from "@/lib/utils";
import type { DataSource, GridSource } from "@/lib/pv-source";

type HeaderProps = {
  lastUpdated: Date | null;
  plantName: string;
  source: DataSource | null;
  gridSource?: GridSource;
};

export function DashboardHeader({ lastUpdated, plantName, source, gridSource }: HeaderProps) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md landscape:py-1.5">
      <div className="dashboard-container flex items-center justify-between gap-3 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm shadow-primary/30">
            <Sun className="size-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="truncate text-base font-semibold leading-tight">
              PV Dash
            </span>
            <span className="truncate text-xs text-muted-foreground leading-tight">
              {plantName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {source ? (
            <span
              className={cn(
                "hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex",
                source === "fusionsolar"
                  ? "bg-chart-1/15 text-chart-1"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Radio className="size-3" />
              {source === "fusionsolar" ? "FusionSolar" : "Simulation"}
            </span>
          ) : null}
          {gridSource === "whatwatt" ? (
            <span className="hidden items-center gap-1 rounded-full bg-chart-3/15 px-2 py-0.5 text-[11px] font-medium text-chart-3 sm:inline-flex">
              <Radio className="size-3" />
              whatwatt Go
            </span>
          ) : null}
          <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-3/70" />
              <span className="relative inline-flex size-2 rounded-full bg-chart-3" />
            </span>
            <span>
              Aktualisiert
              {lastUpdated
                ? ` · ${lastUpdated.toLocaleTimeString("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}`
                : ""}
            </span>
          </div>
          <span className="relative flex size-2 sm:hidden">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-3/70" />
            <span className="relative inline-flex size-2 rounded-full bg-chart-3" />
          </span>
          <BacklogDialog />
          <SettingsDialog />
          <ShareDashboardButton plantName={plantName} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
