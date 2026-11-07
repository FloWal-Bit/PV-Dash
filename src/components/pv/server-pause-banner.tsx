"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  void nowMs;
  // Erst nach dem ersten Live-Versuch anzeigen — sonst blitzt der Banner
  // bei jedem Refresh aus dem Offline-Cache auf, obwohl der Server erreichbar ist.
  const message = formatServerPauseMessage(pause, {
    unreachable: liveProbeDone && serverUnreachable,
    lastFetchedAt,
  });
  if (!message) return null;

  return (
    <div
      className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
      role="status"
    >
      {message}
    </div>
  );
}
