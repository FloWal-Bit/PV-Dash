"use client";

import { useState, useSyncExternalStore } from "react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/pv/settings-dialog";
import { putDevSettings } from "@/lib/dev-settings-sync";
import { extraCardsStore } from "@/lib/extra-cards-store";
import type { MystromKind } from "@/lib/extra-cards-shared";
import { cn } from "@/lib/utils";

const inputClassName =
  "flex h-10 w-full rounded-xl border border-border/80 bg-background px-3 py-2 text-sm shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-chart-3 focus-visible:ring-[3px] focus-visible:ring-chart-3/25 disabled:cursor-not-allowed disabled:opacity-60";

/** Schalter für Lampe und Spotify. Die Karten bleiben aus, bis hier gespeichert wird. */
export function ExtraCardsSettings() {
  const saved = useSyncExternalStore(
    extraCardsStore.subscribe,
    extraCardsStore.getSnapshot,
    extraCardsStore.getServerSnapshot,
  );
  const signature = [
    saved.mystromEnabled,
    saved.mystromBaseUrl,
    saved.mystromKind,
    saved.mystromMac,
    saved.mystromTokenSet,
    saved.spotifyEnabled,
    saved.spotifyUrl,
  ].join("|");
  return <ExtraCardsForm key={signature} saved={saved} />;
}

function ExtraCardsForm({
  saved,
}: {
  saved: ReturnType<typeof extraCardsStore.getSnapshot>;
}) {
  const [mystromEnabled, setMystromEnabled] = useState(saved.mystromEnabled);
  const [baseUrl, setBaseUrl] = useState(saved.mystromBaseUrl);
  const [kind, setKind] = useState<MystromKind>(saved.mystromKind);
  const [mac, setMac] = useState(saved.mystromMac);
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [spotifyEnabled, setSpotifyEnabled] = useState(saved.spotifyEnabled);
  const [spotifyUrl, setSpotifyUrl] = useState(saved.spotifyUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await putDevSettings({
        mystromEnabled,
        mystromBaseUrl: baseUrl,
        mystromKind: kind,
        mystromMac: mac,
        spotifyEnabled,
        spotifyUrl,
        ...(clearToken ? { mystromToken: null } : token.trim() ? { mystromToken: token } : {}),
      });
      setToken("");
      setClearToken(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      icon={<Lightbulb className="size-4" />}
      iconClassName="bg-muted text-foreground/70"
      title="Karten unter dem Verlauf"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">myStrom-Lampe</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Button zum Ein- und Ausschalten. Der Server ruft die Lampe im lokalen Netz auf.
          </span>
        </div>
        <Switch
          aria-label="myStrom-Lampe anzeigen"
          checked={mystromEnabled}
          onCheckedChange={setMystromEnabled}
          className="data-checked:bg-chart-3"
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2" role="radiogroup" aria-label="myStrom-Gerät">
          {(
            [
              ["bulb", "Lampe"],
              ["switch", "Schalter"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-foreground/15",
                kind === value ? "bg-foreground text-background" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className={inputClassName}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://192.168.1.50"
          aria-label="myStrom-Adresse"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {kind === "bulb" ? (
          <input
            className={inputClassName}
            value={mac}
            onChange={(event) => setMac(event.target.value)}
            placeholder="MAC, 12 Zeichen"
            aria-label="MAC der Lampe"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        ) : null}
        <input
          className={inputClassName}
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setClearToken(false);
          }}
          placeholder={saved.mystromTokenSet ? "Token ist gesetzt" : "API-Token, optional"}
          aria-label="myStrom-API-Token"
          type="password"
          autoComplete="off"
        />
        {saved.mystromTokenSet ? (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => {
              setClearToken(true);
              setToken("");
            }}
          >
            {clearToken ? "Token wird beim Speichern entfernt" : "Token entfernen"}
          </button>
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-3 border-t border-border/70 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">Spotify</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Player für einen Titel, ein Album oder eine Playlist.
          </span>
        </div>
        <Switch
          aria-label="Spotify-Player anzeigen"
          checked={spotifyEnabled}
          onCheckedChange={setSpotifyEnabled}
          className="data-checked:bg-chart-3"
        />
      </div>
      <input
        className={inputClassName}
        value={spotifyUrl}
        onChange={(event) => setSpotifyUrl(event.target.value)}
        placeholder="https://open.spotify.com/playlist/…"
        aria-label="Spotify-Link"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="flex items-center justify-end">
        <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? "…" : "Speichern"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}
