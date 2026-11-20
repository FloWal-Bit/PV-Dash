"use client";

import { useSyncExternalStore } from "react";
import { formatKw } from "@/lib/format";
import { surplusBannerStore } from "@/lib/notifications";

/**
 * Live-Hinweis, solange die Überschuss-Regel gilt. Bleibt im Sticky-Block
 * unter dem Info-Banner sichtbar, unabhängig von der System-Mitteilung.
 */
export function SurplusBanner() {
  const exportKw = useSyncExternalStore(
    surplusBannerStore.subscribe,
    surplusBannerStore.getSnapshot,
    surplusBannerStore.getServerSnapshot,
  );
  if (exportKw == null) return null;

  return (
    <div className="dashboard-container bg-background pt-2">
      <p
        className="rounded-2xl bg-chart-3/15 px-4 py-3 text-sm text-chart-3"
        role="status"
      >
        Stromüberschuss: {formatKw(exportKw)} Einspeisung.
      </p>
    </div>
  );
}
