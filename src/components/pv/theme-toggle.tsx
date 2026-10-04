"use client";

import { Check, Moon, Sun, Sunrise } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  THEME_MODE_LABELS,
  type ThemeMode,
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

export function ThemeToggle() {
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
  const todayWeather = weather.byDate[weatherDateKey()] ?? weather.data;
  const sunTimes =
    todayWeather?.sunriseAt && todayWeather.sunsetAt
      ? { sunriseAt: todayWeather.sunriseAt, sunsetAt: todayWeather.sunsetAt }
      : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selectMode = (next: ThemeMode) => {
    themeModeStore.setMode(next);
    setTheme(resolveColorScheme(next, new Date(), sunTimes));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Farbschema wählen"
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-full"
        onClick={() => setOpen((value) => !value)}
      >
        <ModeIcon mode={mode} className="size-[18px]" />
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-[min(calc(100vw-2rem),17rem)] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        >
          {MODES.map((option) => {
            const selected = option === mode;
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
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
        </div>
      ) : null}
    </div>
  );
}
