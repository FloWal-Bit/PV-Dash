"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Lightbulb, LightbulbOff, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deviceIdStore, deviceRequestHeaders } from "@/lib/device-visit";
import { cardDeviceStore, extraCardsStore } from "@/lib/extra-cards-store";
import type { MystromKind } from "@/lib/extra-cards-shared";
import { triggerHaptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

type LampPhase = "loading" | "ready" | "saving";

function MystromLampCard({
  baseUrl,
  kind,
  mac,
}: {
  baseUrl: string;
  kind: MystromKind;
  mac: string;
}) {
  const setupHint = !baseUrl
    ? "Adresse in den Dev-Einstellungen setzen."
    : kind === "bulb" && !mac
      ? "MAC der Lampe in den Dev-Einstellungen setzen."
      : null;
  const [on, setOn] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<LampPhase>(setupHint ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (setupHint) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/mystrom", {
          cache: "no-store",
          headers: deviceRequestHeaders(),
        });
        const body = (await response.json()) as { on?: boolean; error?: string };
        if (cancelled) return;
        if (!response.ok || typeof body.on !== "boolean") {
          setError(body.error ?? "Lampe nicht erreichbar.");
          setPhase("ready");
          return;
        }
        setOn(body.on);
        setError(null);
        setPhase("ready");
      } catch {
        if (cancelled) return;
        setError("Lampe nicht erreichbar.");
        setPhase("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setupHint]);

  async function toggle() {
    if (setupHint || phase === "loading" || phase === "saving") return;
    const next = on !== true;
    setPhase("saving");
    setError(null);
    triggerHaptic("confirm");
    try {
      const response = await fetch("/api/mystrom", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...deviceRequestHeaders() },
        body: JSON.stringify({ on: next }),
      });
      const body = (await response.json()) as { on?: boolean; error?: string };
      if (!response.ok || typeof body.on !== "boolean") {
        setError(body.error ?? "Schalten fehlgeschlagen.");
        setPhase("ready");
        return;
      }
      setOn(body.on);
      setPhase("ready");
    } catch {
      setError("Schalten fehlgeschlagen.");
      setPhase("ready");
    }
  }

  const lit = on === true;
  const stateLabel =
    phase === "loading" || phase === "saving" ? "…" : lit ? "Ein" : on === false ? "Aus" : "–";

  return (
    <Card data-mystrom-card className="shadow-card rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Lampe</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2 pb-4">
        <button
          type="button"
          aria-pressed={lit}
          aria-label="myStrom-Lampe ein- oder ausschalten"
          disabled={setupHint != null || phase === "loading" || phase === "saving"}
          onClick={() => void toggle()}
          className="flex flex-col items-center gap-1.5 rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
        >
          <span
            className={cn(
              "flex size-16 flex-col items-center justify-center gap-0.5 rounded-full border-[3px] bg-gradient-to-br shadow-inner",
              lit
                ? "border-chart-1 from-chart-1/20 to-chart-1/5 text-chart-1"
                : "border-border text-muted-foreground/60",
            )}
          >
            {lit ? <Lightbulb className="size-5" /> : <LightbulbOff className="size-5" />}
            <span className="text-xs font-semibold leading-none">{stateLabel}</span>
          </span>
        </button>
        <span className={cn("text-center text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {setupHint ??
            error ??
            (lit ? "Eingeschaltet" : on === false ? "Ausgeschaltet" : "Tippen zum Schalten")}
        </span>
      </CardContent>
    </Card>
  );
}

type SonosNow = {
  room: string;
  title: string;
  artist: string;
  playing: boolean;
};

function SonosCard({ baseUrl }: { baseUrl: string }) {
  const [now, setNow] = useState<SonosNow | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "saving">(baseUrl ? "loading" : "ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!baseUrl) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/sonos", {
          cache: "no-store",
          headers: deviceRequestHeaders(),
        });
        const data = (await response.json()) as SonosNow & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Sonos nicht erreichbar.");
        if (!cancelled) {
          setNow(data);
          setError(null);
          setPhase("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Sonos nicht erreichbar.");
          setPhase("ready");
        }
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [baseUrl]);

  async function send(action: "play" | "pause" | "next" | "previous") {
    if (!baseUrl || phase === "saving") return;
    triggerHaptic("selection");
    setPhase("saving");
    setError(null);
    try {
      const response = await fetch("/api/sonos", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...deviceRequestHeaders() },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as SonosNow & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Sonos nicht erreichbar.");
      setNow(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sonos nicht erreichbar.");
    } finally {
      setPhase("ready");
    }
  }

  const playing = now?.playing === true;
  const title =
    now?.title || (error ? "" : phase === "loading" ? "…" : baseUrl ? "Nichts läuft" : "");
  const detail = [now?.room, now?.artist].filter(Boolean).join(" · ");

  return (
    <Card data-sonos-card className="shadow-card rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Sonos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pb-4">
        {baseUrl ? (
          <>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{title}</p>
              {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                aria-label="Vorheriger Titel"
                disabled={phase === "saving"}
                onClick={() => void send("previous")}
                className="flex size-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
              >
                <SkipBack className="size-4" />
              </button>
              <button
                type="button"
                aria-label={playing ? "Pause" : "Wiedergabe"}
                disabled={phase === "saving"}
                onClick={() => void send(playing ? "pause" : "play")}
                className="flex size-12 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-50"
              >
                {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
              </button>
              <button
                type="button"
                aria-label="Nächster Titel"
                disabled={phase === "saving"}
                onClick={() => void send("next")}
                className="flex size-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
              >
                <SkipForward className="size-4" />
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Adresse in den Dev-Einstellungen setzen.
          </p>
        )}
        {error ? <p className="text-center text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Lampe und Sonos nur auf angehakten Geräten, und nur wenn der Schalter an ist. */
export function ExtraCards() {
  const deviceId = useSyncExternalStore(
    deviceIdStore.subscribe,
    deviceIdStore.getSnapshot,
    deviceIdStore.getServerSnapshot,
  );
  const cardDeviceIds = useSyncExternalStore(
    cardDeviceStore.subscribe,
    cardDeviceStore.getSnapshot,
    cardDeviceStore.getServerSnapshot,
  );
  const settings = useSyncExternalStore(
    extraCardsStore.subscribe,
    extraCardsStore.getSnapshot,
    extraCardsStore.getServerSnapshot,
  );
  const allowed =
    deviceId != null && cardDeviceIds.some((id) => id === deviceId.toLowerCase());
  if (!allowed) return null;
  if (!settings.mystromEnabled && !settings.sonosEnabled) return null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {settings.mystromEnabled ? (
        <MystromLampCard
          key={`${settings.mystromBaseUrl}\0${settings.mystromKind}\0${settings.mystromMac}\0${String(settings.mystromTokenSet)}`}
          baseUrl={settings.mystromBaseUrl}
          kind={settings.mystromKind}
          mac={settings.mystromMac}
        />
      ) : null}
      {settings.sonosEnabled ? <SonosCard baseUrl={settings.sonosBaseUrl} /> : null}
    </div>
  );
}
