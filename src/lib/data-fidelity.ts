import type { CSSProperties } from "react";
import type { DataSource, GridSource } from "@/lib/pv-source";

/** Opacity für simulierte oder geschätzte Werte (Live-Daten bleiben bei 1). */
export const SIMULATED_OPACITY = 0.5;

export const SIMULATED_OPACITY_CLASS = "opacity-50";

export function isPvSimulated(source: DataSource): boolean {
  return source === "simulation";
}

export function isGridSimulated(gridSource: GridSource): boolean {
  return gridSource !== "whatwatt";
}

export function simulatedOpacityStyle(simulated: boolean): CSSProperties | undefined {
  return simulated ? { opacity: SIMULATED_OPACITY } : undefined;
}
