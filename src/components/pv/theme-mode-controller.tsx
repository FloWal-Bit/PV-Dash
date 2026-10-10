"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import {
  applyDocumentColorScheme,
  msUntilNextSunThemeSwitch,
  resolveColorScheme,
  themeModeStore,
} from "@/lib/theme-mode";
import { weatherDateKey, weatherStore } from "@/lib/weather-store";

function todaySunTimes(): { sunriseAt: string; sunsetAt: string } | null {
  const today = weatherStore.getWeatherForDate(weatherDateKey());
  if (!today?.sunriseAt || !today.sunsetAt) return null;
  return { sunriseAt: today.sunriseAt, sunsetAt: today.sunsetAt };
}

export function ThemeModeController() {
  const { setTheme } = useTheme();
  const mode = useSyncExternalStore(
    themeModeStore.subscribe,
    themeModeStore.getSnapshot,
    themeModeStore.getServerSnapshot,
  );
  const weather = useSyncExternalStore(
    weatherStore.subscribe,
    weatherStore.getSnapshot,
    weatherStore.getServerSnapshot,
  );

  const sunTimes = useMemo(
    () => todaySunTimes(),
    [weather.byDate, weather.data, weather.locationKey],
  );

  useEffect(() => {
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

    const apply = () => {
      const scheme = resolveColorScheme(mode, new Date(), sunTimes);
      applyDocumentColorScheme(scheme);
      setTheme(scheme);
    };

    const schedule = () => {
      globalThis.clearTimeout(timeoutId);
      apply();
      if (mode !== "sun") return;
      const delay = msUntilNextSunThemeSwitch(new Date());
      if (delay == null) return;
      timeoutId = globalThis.setTimeout(schedule, Math.max(1_000, delay));
    };

    schedule();
    return () => globalThis.clearTimeout(timeoutId);
  }, [mode, sunTimes, setTheme]);

  return null;
}
