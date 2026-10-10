"use client";

import { Check, Moon, Sun, Sunrise } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import {
  DARK_VARIANT_LABELS,
  type DarkVariant,
  THEME_MODE_LABELS,
  type ThemeMode,
  applyDocumentColorScheme,
  darkVariantStore,
  resolveColorScheme,
  themeModeStore,
} from "@/lib/theme-mode";
import { weatherDateKey, weatherStore } from "@/lib/weather-store";
import { cn } from "@/lib/utils";

const MODES: ThemeMode[] = ["light", "dark", "sun"];

function ModeIcon({ mode, className }: { mode: ThemeMode; className?: string }) {
  if (mode === "dark") return <Moon className={className} />;
  if (mode === "sun") return <Sunrise className={className} />;
  return <Sun className={className} />;
}

export function ThemeModeSetting() {
  const { setTheme } = useTheme();
  const mode = useSyncExternalStore(
    themeModeStore.subscribe,
    themeModeStore.getSnapshot,
    themeModeStore.getServerSnapshot,
  );
  const darkVariant = useSyncExternalStore(
    darkVariantStore.subscribe,
    darkVariantStore.getSnapshot,
    darkVariantStore.getServerSnapshot,
  );
  const weather = useSyncExternalStore(
    weatherStore.subscribe,
    weatherStore.getSnapshot,
    weatherStore.getServerSnapshot,
  );
  const todayWeather = weather.byDate[weatherDateKey()] ?? weather.data;
  const sunTimes =
    todayWeather?.sunriseAt && todayWeather.sunsetAt
      ? { sunriseAt: todayWeather.sunriseAt, sunsetAt: todayWeather.sunsetAt }
      : null;

  const scheme = resolveColorScheme(mode, new Date(), sunTimes);

  const selectMode = (next: ThemeMode) => {
    themeModeStore.setMode(next);
    const nextScheme = resolveColorScheme(next, new Date(), sunTimes);
    applyDocumentColorScheme(nextScheme);
    setTheme(nextScheme);
  };

  const selectDarkVariant = (next: DarkVariant) => {
    darkVariantStore.setVariant(next);
    applyDocumentColorScheme("dark");
    setTheme("dark");
  };

  return (
    <div role="radiogroup" aria-label="Farbschema" className="flex flex-col gap-1">
      {MODES.map((option) => {
        const selected = option === mode;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
              selected && "bg-muted/80",
            )}
            onClick={() => selectMode(option)}
          >
            <ModeIcon mode={option} className="mt-0.5 size-4 shrink-0 opacity-80" />
            <span className="min-w-0 flex-1 leading-snug">{THEME_MODE_LABELS[option]}</span>
            {selected ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
          </button>
        );
      })}
      {scheme === "dark" ? (
        <div
          role="radiogroup"
          aria-label="Dunkles Design"
          className="mt-1 flex flex-col gap-1 border-t border-border/70 pt-2"
        >
          <span className="px-2 text-xs font-medium text-muted-foreground">Dunkles Design</span>
          {(Object.keys(DARK_VARIANT_LABELS) as DarkVariant[]).map((option) => {
            const selected = option === darkVariant;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                  selected && "bg-muted/80",
                )}
                onClick={() => selectDarkVariant(option)}
              >
                <span className="min-w-0 flex-1 leading-snug">{DARK_VARIANT_LABELS[option]}</span>
                {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
