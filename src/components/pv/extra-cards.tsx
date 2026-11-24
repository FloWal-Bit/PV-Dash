"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Lightbulb, LightbulbOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extraCardsStore } from "@/lib/extra-cards-store";
import { spotifyEmbedSrc, type MystromKind } from "@/lib/extra-cards-shared";
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
        const response = await fetch("/api/mystrom", { cache: "no-store" });
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
        headers: { "Content-Type": "application/json" },
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

function SpotifyPlayerCard({ url }: { url: string }) {
  const src = spotifyEmbedSrc(url);
  return (
    <Card data-spotify-card className="shadow-card rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Spotify</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        {src ? (
          <iframe
            title="Spotify"
            src={src}
            className="h-[152px] w-full rounded-xl border-0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Spotify-Link in den Dev-Einstellungen setzen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Zwei kleine Karten unter dem Verlauf. Jede nur, wenn sie in den Dev-Einstellungen an ist. */
export function ExtraCards() {
  const settings = useSyncExternalStore(
    extraCardsStore.subscribe,
    extraCardsStore.getSnapshot,
    extraCardsStore.getServerSnapshot,
  );
  if (!settings.mystromEnabled && !settings.spotifyEnabled) return null;

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
      {settings.spotifyEnabled ? <SpotifyPlayerCard url={settings.spotifyUrl} /> : null}
    </div>
  );
}
