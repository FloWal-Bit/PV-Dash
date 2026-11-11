"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pvStore } from "@/lib/pv-store";
import { isScheduledServerPause } from "@/lib/server-pause-window";

function formatLastStand(lastFetchedAt: number | null): string {
  if (lastFetchedAt == null) return "";
  const last = new Date(lastFetchedAt).toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return ` Letzter Stand: ${last} Uhr.`;
}

function formatUnreachableMessage(
  lastFetchedAt: number | null,
  nowMs: number,
): string {
  const cached = formatLastStand(lastFetchedAt);
  if (isScheduledServerPause(nowMs)) {
    return `Die Serververbindung wird zwischen 23.30 und 06.00 Uhr ausgesetzt. Die Daten werden aktualisiert, sobald der Server wieder läuft.${cached}`;
  }
  return `Server nicht erreichbar — es werden gespeicherte Werte angezeigt. Die Daten werden aktualisiert, sobald der Server wieder läuft.${cached}`;
}

/** Hinweis wenn der Node unerreichbar ist (Pause, Offline, Flugmodus) — nutzt gespeicherte Werte. */
export function ServerPauseBanner() {
  const { serverUnreachable, lastFetchedAt, liveProbeDone } = useSyncExternalStore(
    pvStore.subscribe,
    pvStore.getSnapshot,
    pvStore.getServerSnapshot,
  );
  const [dismissed, setDismissed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Nach Wiedererreichbarkeit erneut anzeigen, falls der Server später wieder ausfällt.
  useEffect(() => {
    if (!serverUnreachable) setDismissed(false);
  }, [serverUnreachable]);

  // Minuten-Takt, damit der Text an 23:30 / 06:00 umschaltet.
  useEffect(() => {
    if (!serverUnreachable) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [serverUnreachable]);

  // Erst nach dem ersten Live-Versuch anzeigen — sonst blitzt der Banner
  // bei jedem Refresh aus dem Offline-Cache auf, obwohl der Server erreichbar ist.
  if (!liveProbeDone || !serverUnreachable || dismissed) return null;

  const message = formatUnreachableMessage(lastFetchedAt, nowMs);

  return (
    <div
      className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
      role="status"
    >
      <p className="min-w-0 flex-1 leading-relaxed">{message}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-amber-700/80 hover:bg-amber-500/15 hover:text-amber-700 dark:text-amber-400/80 dark:hover:text-amber-400"
        aria-label="Meldung schliessen"
        onClick={() => setDismissed(true)}
      >
        <X />
      </Button>
    </div>
  );
}
