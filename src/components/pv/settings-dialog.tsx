"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { BatteryFull, Bell, Info, MapPin, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  notificationSettingsStore,
  sendTestNotification,
  YIELD_NOTIFICATION_THRESHOLD_KWH,
} from "@/lib/notifications";
import {
  DEFAULT_SITE_LOCATION,
  parseCoordinateInput,
  siteLocationStore,
} from "@/lib/site-location";
import {
  DEFAULT_STROMKONTO_BALANCE_KWH,
  parseStromkontoBalanceInput,
} from "@/lib/stromkonto-shared";
import { formatYieldKwh } from "@/lib/format";
import { APP_NAME, APP_VERSION_LABEL } from "@/lib/version";
import { cn } from "@/lib/utils";

const inputClassName =
  "flex h-10 w-full rounded-xl border border-border/80 bg-background px-3 py-2 text-sm shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-chart-3 focus-visible:ring-[3px] focus-visible:ring-chart-3/25 disabled:cursor-not-allowed disabled:opacity-60";

function SettingsSection({
  icon,
  iconClassName,
  title,
  children,
}: {
  icon: ReactNode;
  iconClassName: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            iconClassName,
          )}
        >
          {icon}
        </div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SiteLocationEditor({
  location,
  isCustom,
}: {
  location: { name: string; latitude: number; longitude: number };
  isCustom: boolean;
}) {
  const [locationName, setLocationName] = useState(location.name);
  const [latitudeInput, setLatitudeInput] = useState(String(location.latitude));
  const [longitudeInput, setLongitudeInput] = useState(String(location.longitude));
  const [locationError, setLocationError] = useState<string | null>(null);

  function handleSaveLocation() {
    const latitude = parseCoordinateInput(latitudeInput);
    const longitude = parseCoordinateInput(longitudeInput);
    if (latitude == null || longitude == null) {
      setLocationError("Bitte gültige Koordinaten eingeben (Dezimalzahl, z. B. 47.1316).");
      return;
    }
    siteLocationStore.save({ name: locationName, latitude, longitude });
    setLocationError(null);
  }

  function handleResetLocation() {
    siteLocationStore.resetToDefault();
    setLocationError(null);
  }

  return (
    <SettingsSection
      icon={<MapPin className="size-4" />}
      iconClassName="bg-chart-2/12 text-chart-2"
      title="Standort"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Bezeichnung für die Wetter-Alarm-Ortssuche; Koordinaten als Fallback für
        astronomische Berechnungen. Standard ist {DEFAULT_SITE_LOCATION.name} (
        {DEFAULT_SITE_LOCATION.latitude}, {DEFAULT_SITE_LOCATION.longitude}).
        {isCustom ? " Du verwendest einen angepassten Standort." : " Aktuell Standard."}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="site-location-name">Bezeichnung</Label>
        <input
          id="site-location-name"
          type="text"
          className={inputClassName}
          value={locationName}
          onChange={(e) => setLocationName(e.target.value)}
          placeholder="z. B. Bätterkinden"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="site-latitude">Breitengrad</Label>
          <input
            id="site-latitude"
            type="text"
            inputMode="decimal"
            className={inputClassName}
            value={latitudeInput}
            onChange={(e) => setLatitudeInput(e.target.value)}
            placeholder="47.1316"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="site-longitude">Längengrad</Label>
          <input
            id="site-longitude"
            type="text"
            inputMode="decimal"
            className={inputClassName}
            value={longitudeInput}
            onChange={(e) => setLongitudeInput(e.target.value)}
            placeholder="7.5382"
          />
        </div>
      </div>

      {locationError ? <p className="text-xs text-destructive">{locationError}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleSaveLocation}>
          Standort speichern
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleResetLocation}>
          Standard ({DEFAULT_SITE_LOCATION.name})
        </Button>
      </div>
    </SettingsSection>
  );
}

function StromkontoEditor() {
  const [balanceInput, setBalanceInput] = useState(String(DEFAULT_STROMKONTO_BALANCE_KWH));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/stromkonto");
        if (!response.ok) throw new Error("Laden fehlgeschlagen");
        const data: { balanceKwh: number } = await response.json();
        if (!cancelled) setBalanceInput(String(data.balanceKwh));
      } catch {
        if (!cancelled) {
          setError("Basiskontostand konnte nicht geladen werden.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveBalance() {
    const balanceKwh = parseStromkontoBalanceInput(balanceInput);
    if (balanceKwh == null) {
      setError("Bitte einen gültigen kWh-Wert eingeben (z. B. 516).");
      setSuccess(null);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/stromkonto", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balanceKwh }),
      });
      const data: { balanceKwh?: number; reAnchored?: boolean; error?: string } =
        await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Speichern fehlgeschlagen");
      }
      setBalanceInput(String(data.balanceKwh));
      setSuccess(
        data.reAnchored
          ? "Basiskontostand gespeichert und an aktuelle Zählerstände angeheftet."
          : "Basiskontostand gespeichert. Anheftung erfolgt beim nächsten whatwatt-Messwert.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      icon={<BatteryFull className="size-4 -rotate-90" />}
      iconClassName="bg-chart-3/12 text-chart-3"
      title="Stromkonto"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Dein aktueller Basiskontostand in kWh. {APP_NAME} addiert oder subtrahiert
        laufende Netto-Veränderungen (Einspeisung minus Bezug) aus whatwatt Go.
        Standard: {formatYieldKwh(DEFAULT_STROMKONTO_BALANCE_KWH, 0)}.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stromkonto-balance">Basiskontostand (kWh)</Label>
        <input
          id="stromkonto-balance"
          type="text"
          inputMode="decimal"
          className={inputClassName}
          value={balanceInput}
          disabled={loading || saving}
          onChange={(e) => setBalanceInput(e.target.value)}
          placeholder="516"
        />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {success ? <p className="text-xs text-chart-3">{success}</p> : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={loading || saving}
        onClick={() => void handleSaveBalance()}
      >
        {saving ? "Speichern…" : "Basiskontostand speichern"}
      </Button>
    </SettingsSection>
  );
}

/**
 * Einstellungen-Dialog des Dashboards: Standort, Stromkonto und Benachrichtigungen.
 */
export function SettingsDialog() {
  const { enabled, permission } = useSyncExternalStore(
    notificationSettingsStore.subscribe,
    notificationSettingsStore.getSnapshot,
    notificationSettingsStore.getServerSnapshot,
  );
  const { location, isCustom } = useSyncExternalStore(
    siteLocationStore.subscribe,
    siteLocationStore.getSnapshot,
    siteLocationStore.getServerSnapshot,
  );
  const [pending, setPending] = useState(false);

  async function handleToggle(checked: boolean) {
    if (!checked) {
      notificationSettingsStore.disable();
      return;
    }
    setPending(true);
    await notificationSettingsStore.enable();
    setPending(false);
  }

  const isUnsupported = permission === "unsupported";
  const isDenied = permission === "denied";

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label="Einstellungen"
          />
        }
      >
        <Settings2 className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="border-b border-border/70 bg-muted/40 px-5 py-4">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg">Einstellungen</DialogTitle>
            <DialogDescription>
              Standort, Stromkonto und Benachrichtigungen für {APP_NAME}.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex max-h-[min(70dvh,36rem)] flex-col gap-3 overflow-y-auto px-5 py-4">
          <StromkontoEditor />

          <SiteLocationEditor
            key={`${location.name}:${location.latitude}:${location.longitude}`}
            location={location}
            isCustom={isCustom}
          />

          <SettingsSection
            icon={<Bell className="size-4" />}
            iconClassName="bg-muted text-foreground/70"
            title="Benachrichtigungen"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor="push-notifications">Push-Benachrichtigungen</Label>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Meldung, sobald die Anlage heute mehr als{" "}
                  {formatYieldKwh(YIELD_NOTIFICATION_THRESHOLD_KWH, 0)} erzeugt hat.
                </span>
              </div>
              <Switch
                id="push-notifications"
                checked={enabled}
                disabled={pending || isUnsupported}
                onCheckedChange={handleToggle}
                className="data-checked:bg-chart-3"
              />
            </div>

            {isUnsupported ? (
              <p className="text-xs text-muted-foreground">
                Push-Benachrichtigungen werden in diesem Browser nicht unterstützt.
              </p>
            ) : isDenied ? (
              <p className="text-xs text-destructive">
                Benachrichtigungen sind für diese Seite blockiert. Erlaube sie in den
                Browser-/Geräteeinstellungen, um sie hier zu aktivieren.
              </p>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!enabled}
              onClick={() => sendTestNotification()}
            >
              Testbenachrichtigung senden
            </Button>
          </SettingsSection>

          <SettingsSection
            icon={<Info className="size-4" />}
            iconClassName="bg-muted text-foreground/70"
            title="Impressum"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Entstanden in Zusammenarbeit mit Koffein, Cursor und der Musik von Paul
              Kalkbrenner.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Externe Datenquellen (ohne Gewähr, jeweils gemäss Anbieter): Wetter,
              Sonnenauf- und -untergang sowie Sonnenstunden von{" "}
              <a
                href="https://wetteralarm.ch/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Wetter-Alarm
              </a>
              ; solare Ertragsprognose aus{" "}
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Open-Meteo
              </a>{" "}
              (GTI, PR 0,78).
            </p>
            <p className="text-xs text-muted-foreground">Herbst 2026</p>
          </SettingsSection>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/30 px-5 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{APP_NAME}</span>
            <span className="text-xs text-muted-foreground">PV-Monitor</span>
          </div>
          <span className="rounded-full bg-background px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-border">
            {APP_VERSION_LABEL}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
