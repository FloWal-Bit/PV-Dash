/**
 * Kurzes haptisches Feedback (Android Chrome / installierte PWA).
 * iOS Safari unterstützt die Vibration API nicht — dort No-Op.
 */

export type HapticKind = "selection" | "tab";

const PATTERNS: Record<HapticKind, number | number[]> = {
  /** Beim Scrubben durch Chart-Punkte / Balken. */
  selection: 8,
  /** Beim Wechseln eines Karten-Tabs. */
  tab: 12,
};

export function triggerHaptic(kind: HapticKind = "selection"): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // ältere WebViews / Permission
  }
}
