"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { ShareDashboardButton } from "@/components/pv/share-dashboard-button";
import { BacklogDialog } from "@/components/pv/backlog-dialog";
import { SettingsDialog } from "@/components/pv/settings-dialog";
import { cn } from "@/lib/utils";
import type { DataSource, GridSource } from "@/lib/pv-source";

const BACKLOG_TAP_COUNT = 5;
const BACKLOG_TAP_GAP_MS = 1500;

/** Weiteres Tippen auf den Titel soll das schon offene Backlog nicht schliessen. */
function pointerHitsTitle(event: Event): boolean {
  const point = pointerPoint(event);
  if (!point) return false;
  const title = document.querySelector("[data-backlog-trigger]");
  if (!title) return false;
  const rect = title.getBoundingClientRect();
  return (
    point.clientX >= rect.left &&
    point.clientX <= rect.right &&
    point.clientY >= rect.top &&
    point.clientY <= rect.bottom
  );
}

function pointerPoint(event: Event): { clientX: number; clientY: number } | null {
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (!touch) return null;
    return { clientX: touch.clientX, clientY: touch.clientY };
  }
  if (!("clientX" in event) || !("clientY" in event)) return null;
  const clientX = event.clientX;
  const clientY = event.clientY;
  if (typeof clientX !== "number" || typeof clientY !== "number") return null;
  return { clientX, clientY };
}

type HeaderProps = {
  lastUpdated: Date | null;
  plantName: string;
  source: DataSource | null;
  gridSource?: GridSource;
  sourceWarning?: string | null;
  gridWarning?: string | null;
};

const badgeToneClass = {
  green: "bg-chart-3/15 text-chart-3",
  amber: "bg-chart-1/15 text-chart-1",
  muted: "bg-muted text-muted-foreground",
} as const;

export function DashboardHeader({
  lastUpdated,
  plantName,
  source,
  gridSource,
  sourceWarning,
  gridWarning,
}: HeaderProps) {
  const [backlogOpen, setBacklogOpen] = useState(false);
  const taps = useRef({ count: 0, last: 0 });
  const backlogOpenedAt = useRef(0);

  function handleTitleTap() {
    const now = Date.now();
    if (backlogOpen) return;
    if (now - taps.current.last > BACKLOG_TAP_GAP_MS) {
      taps.current.count = 0;
    }
    taps.current.last = now;
    taps.current.count += 1;
    if (taps.current.count >= BACKLOG_TAP_COUNT) {
      taps.current.count = 0;
      backlogOpenedAt.current = now;
      setBacklogOpen(true);
    }
  }

  function handleBacklogOpenChange(
    open: boolean,
    details: { reason: string; event: Event; cancel: () => void },
  ) {
    const burstStillRunning = Date.now() - backlogOpenedAt.current < BACKLOG_TAP_GAP_MS;
    if (!open && details.reason === "outside-press" && (burstStillRunning || pointerHitsTitle(details.event))) {
      details.cancel();
      return;
    }
    setBacklogOpen(open);
  }

  return (
    <header className="safe-top sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md landscape:py-1.5">
      <div className="dashboard-container flex items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-col pl-4">
          <button
            type="button"
            onClick={handleTitleTap}
            data-backlog-trigger=""
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
            <StatusBadge
              label={source === "fusionsolar" ? "FusionSolar" : "Simulation"}
              tone={source === "fusionsolar" ? "green" : sourceWarning ? "amber" : "muted"}
              detail={
                source === "fusionsolar"
                  ? null
                  : (sourceWarning ?? "FusionSolar liefert keine Livedaten. Angezeigt wird die Simulation.")
              }
            />
          ) : null}
          {gridSource === "whatwatt" || gridWarning ? (
            <StatusBadge
              label="whatwatt Go"
              tone={gridSource === "whatwatt" && !gridWarning ? "green" : "amber"}
              detail={gridSource === "whatwatt" && !gridWarning ? null : gridWarning}
            />
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
          <BacklogDialog open={backlogOpen} onOpenChange={handleBacklogOpenChange} />
          <SettingsDialog />
          <ShareDashboardButton plantName={plantName} />
        </div>
      </div>
    </header>
  );
}

function StatusBadge({
  label,
  tone,
  detail,
}: {
  label: string;
  tone: keyof typeof badgeToneClass;
  detail: string | null | undefined;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const className = cn(
    "hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex",
    badgeToneClass[tone],
  );

  useEffect(() => {
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (!open || !panel || !button) return;
    if (!panel.matches(":popover-open")) panel.showPopover();
    const rect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(rect.right - panelRect.width, window.innerWidth - margin - panelRect.width));
    let top = rect.bottom + 6;
    if (top + panelRect.height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 6 - panelRect.height);
    }
    panel.style.inset = "auto";
    panel.style.margin = "0";
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!detail) {
    return (
      <span className={className}>
        <Radio className="size-3" />
        {label}
      </span>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <Radio className="size-3" />
        {label}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="note"
          popover="manual"
          className="fixed z-50 m-0 w-72 rounded-xl border-0 bg-popover p-3 text-xs leading-snug text-popover-foreground shadow-card ring-1 ring-foreground/10"
        >
          {detail}
        </div>
      ) : null}
    </>
  );
}
