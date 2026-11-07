"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatServerPauseMessage } from "@/lib/server-pause";
import { serverPauseSettingsStore } from "@/lib/server-pause-settings";
import { pvStore } from "@/lib/pv-store";

/** Hinweis bei Server-Pause / unerreichbarem Node — nutzt gespeicherte Werte. */
export function ServerPauseBanner() {
  const pause = useSyncExternalStore(
    serverPauseSettingsStore.subscribe,
    serverPauseSettingsStore.getSnapshot,
    serverPauseSettingsStore.getServerSnapshot,
  );
  const { serverUnreachable, lastFetchedAt, liveProbeDone } = useSyncExternalStore(
    pvStore.subscribe,
    pvStore.getSnapshot,
    pvStore.getServerSnapshot,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Nach Wiedererreichbarkeit erneut anzeigen, falls der Server später wieder ausfällt.
  useEffect(() => {
    if (!serverUnreachable) setDismissed(false);
  }, [serverUnreachable]);

  void nowMs;
  // Erst nach dem ersten Live-Versuch anzeigen — sonst blitzt der Banner
  // bei jedem Refresh aus dem Offline-Cache auf, obwohl der Server erreichbar ist.
  const message = formatServerPauseMessage(pause, {
    unreachable: liveProbeDone && serverUnreachable,
    lastFetchedAt,
  });
  if (!message || dismissed) return null;

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
