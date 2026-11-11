/**
 * Nach Node-Start (typisch ~06:00 nach Nachtpause): einmalig FusionSolar-
 * Caches und Open-Meteo hintereinander wärmen, damit parallele Client-Tabs
 * keinen Burst gegen die Huawei-Limits auslösen.
 */

import { isFusionSolarConfigured } from "@/lib/fusionsolar/config";
import { warmFusionSolarCachesSequential } from "@/lib/fusionsolar/service";
import { getSharedDevSettings } from "@/lib/dev-settings";
import { defaultYieldForecastPlant } from "@/lib/yield-forecast-settings";
import { getOpenMeteoTodayAndTomorrowYieldKwh } from "@/lib/open-meteo-yield/service";

const STEP_GAP_MS = 750;

let warmedAt: number | null = null;
let catchupInFlight: Promise<void> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isStartupCatchupPending(): boolean {
  return catchupInFlight != null;
}

export function getStartupWarmedAt(): number | null {
  return warmedAt;
}

/**
 * Idempotent: parallele Requests teilen sich denselben Catch-up.
 * Nach Erfolg sofort no-op bis Prozess-Neustart.
 */
export async function ensureStartupCatchup(): Promise<void> {
  if (warmedAt != null) return;
  if (catchupInFlight) return catchupInFlight;

  catchupInFlight = (async () => {
    try {
      if (isFusionSolarConfigured()) {
        await warmFusionSolarCachesSequential({ gapMs: STEP_GAP_MS });
        await delay(STEP_GAP_MS);
      }

      const devSettings = getSharedDevSettings();
      await getOpenMeteoTodayAndTomorrowYieldKwh(
        {
          ...defaultYieldForecastPlant(),
          performanceRatio: devSettings.performanceRatio,
        },
        new Date(),
      );

      warmedAt = Date.now();
      console.info("[catchup] Startup-Warmup fertig", { warmedAt });
    } catch (err) {
      // Teilweise gefüllte Caches bleiben; nächster Request darf normal weiterlaufen.
      const message = err instanceof Error ? err.message : String(err);
      console.error("[catchup] Startup-Warmup mit Fehler beendet:", message);
      warmedAt = Date.now();
    } finally {
      catchupInFlight = null;
    }
  })();

  return catchupInFlight;
}
