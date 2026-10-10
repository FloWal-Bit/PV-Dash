"use client";

import { useRef, useState } from "react";
import { Radio } from "lucide-react";
import { ShareDashboardButton } from "@/components/pv/share-dashboard-button";
import { BacklogDialog } from "@/components/pv/backlog-dialog";
import { SettingsDialog } from "@/components/pv/settings-dialog";
import { cn } from "@/lib/utils";
import type { DataSource, GridSource } from "@/lib/pv-source";

const BACKLOG_TAP_COUNT = 5;
const BACKLOG_TAP_GAP_MS = 1500;

type HeaderProps = {
  lastUpdated: Date | null;
  plantName: string;
  source: DataSource | null;
  gridSource?: GridSource;
};

export function DashboardHeader({ lastUpdated, plantName, source, gridSource }: HeaderProps) {
  const [backlogOpen, setBacklogOpen] = useState(false);
  const taps = useRef({ count: 0, last: 0 });

  function handleTitleTap() {
    const now = Date.now();
    if (now - taps.current.last > BACKLOG_TAP_GAP_MS) {
      taps.current.count = 0;
    }
    taps.current.last = now;
    taps.current.count += 1;
    if (taps.current.count >= BACKLOG_TAP_COUNT) {
      taps.current.count = 0;
      setBacklogOpen(true);
    }
  }

  return (
    <header className="safe-top sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md landscape:py-1.5">
      <div className="dashboard-container flex items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-col pl-4">
          <button
            type="button"
            onClick={handleTitleTap}
            className="truncate text-left text-base font-semibold leading-tight"
          >
            PV Dash
          </button>
          <span className="truncate text-xs text-muted-foreground leading-tight">
            {plantName}
          </span>
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
          <BacklogDialog open={backlogOpen} onOpenChange={setBacklogOpen} />
          <SettingsDialog />
          <ShareDashboardButton plantName={plantName} />
        </div>
      </div>
    </header>
  );
}
