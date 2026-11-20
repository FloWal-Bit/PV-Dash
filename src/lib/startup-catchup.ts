/**
 * Nach Node-Start (typisch ~06:00 nach Nachtpause): einmalig Caches
 * hintereinander wärmen, damit parallele Client-Tabs keinen Burst auslösen.
 *
 * Reihenfolge (je ~750 ms Pause zwischen den FusionSolar-Schritten):
 * 1. FusionSolar Live — danach darf /api/pv antworten
 * 2. FS Heute-Kurve (5‑Min)
 * 3. FS Woche/Monat/Jahr
 * 4. FS Laufzeit — danach darf /api/pv/history antworten
 * 5. Open-Meteo Ertragsprognose
 * 6. Wetter-Alarm Heute
 * 7. Wetter-Alarm Morgen
 *
 * Live und Verlauf warten nicht auf Wetter und Prognose. Sonst bleibt das
 * Telefon auf dem Offline-Cache vom Vortag, bis der ganze Warmup durch ist,
 * und ein Pull-to-Refresh bricht den wartenden Abruf nur ab.
 *
 * Wetter-Alarm steckt bewusst im Warmup — nicht erst auf die Client-Marke
 * 06:00 warten (Card 1 ist dann sofort bedient).
 */

import { isFusionSolarConfigured } from "@/lib/fusionsolar/config";
import { warmFusionSolarCachesSequential } from "@/lib/fusionsolar/service";
import { getSharedDevSettings } from "@/lib/dev-settings";
import { defaultYieldForecastPlant } from "@/lib/yield-forecast-settings";
import { getOpenMeteoTodayAndTomorrowYieldKwh } from "@/lib/open-meteo-yield/service";
import { getWetterAlarmDailyWeather } from "@/lib/wetteralarm/service";
import { DEFAULT_SITE_LOCATION } from "@/lib/site-location";
import { warmWhatWattConnection } from "@/lib/whatwatt/service";

const STEP_GAP_MS = 750;

let warmedAt: number | null = null;
let catchupInFlight: Promise<void> | null = null;
/** Löst auf, sobald die FusionSolar-Verlaufs-Caches gefüllt oder fehlgeschlagen sind. */
let historyReadyPromise: Promise<void> = Promise.resolve();
let resolveHistoryReady: (() => void) | null = null;

function finishHistoryReady(): void {
  resolveHistoryReady?.();
  resolveHistoryReady = null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tomorrowDate(from = new Date()): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  return next;
}

export function isStartupCatchupPending(): boolean {
  return catchupInFlight != null;
}

export function getStartupWarmedAt(): number | null {
  return warmedAt;
}

/**
 * Idempotent: parallele Requests teilen sich denselben Catch-up.
 * Nach Erfolg no-op bis Prozess-Neustart.
 */
export function ensureStartupCatchup(): Promise<void> {
  if (warmedAt != null) return Promise.resolve();
  if (catchupInFlight) return catchupInFlight;

  historyReadyPromise = new Promise<void>((resolve) => {
    resolveHistoryReady = resolve;
  });

  catchupInFlight = (async () => {
    try {
      // MQTT schon verbinden, während FusionSolar noch läuft.
      warmWhatWattConnection();

      if (isFusionSolarConfigured()) {
        console.info("[catchup] 1–4 FusionSolar sequentiell…");
        await warmFusionSolarCachesSequential({
          gapMs: STEP_GAP_MS,
          onHistoryReady: finishHistoryReady,
        });
        await delay(STEP_GAP_MS);
      } else {
        finishHistoryReady();
      }

      console.info("[catchup] 5 Open-Meteo…");
      const devSettings = getSharedDevSettings();
      await getOpenMeteoTodayAndTomorrowYieldKwh(
        {
          ...defaultYieldForecastPlant(),
          performanceRatio: devSettings.performanceRatio,
        },
        new Date(),
      );
      await delay(STEP_GAP_MS);

      const locationName = DEFAULT_SITE_LOCATION.name;
      console.info("[catchup] 6 Wetter-Alarm heute…", { locationName });
      await getWetterAlarmDailyWeather({
        locationName,
        date: new Date(),
      });
      await delay(STEP_GAP_MS);

      console.info("[catchup] 7 Wetter-Alarm morgen…");
      await getWetterAlarmDailyWeather({
        locationName,
        date: tomorrowDate(),
      });

      warmedAt = Date.now();
      console.info("[catchup] Startup-Warmup fertig", { warmedAt });
    } catch (err) {
      // Teilweise gefüllte Caches bleiben; nächster Request darf normal weiterlaufen.
      const message = err instanceof Error ? err.message : String(err);
      console.error("[catchup] Startup-Warmup mit Fehler beendet:", message);
      warmedAt = Date.now();
    } finally {
      finishHistoryReady();
      catchupInFlight = null;
    }
  })();

  return catchupInFlight;
}

/**
 * Verlaufs-Route wartet nur auf die FusionSolar-Schritte, nicht auf
 * Open-Meteo und Wetter-Alarm.
 */
export function whenStartupHistoryReady(): Promise<void> {
  void ensureStartupCatchup();
  return historyReadyPromise;
}
