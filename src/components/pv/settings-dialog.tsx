"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { BatteryFull, Bell, EyeOff, Info, MapPin, Settings2 } from "lucide-react";
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
import type { PlzLocality, PlzLookupResponse } from "@/lib/plz-types";
import { DEFAULT_SITE_LOCATION, siteLocationStore } from "@/lib/site-location";
import {
  DEFAULT_STROMKONTO_BALANCE_KWH,
  parseStromkontoBalanceInput,
} from "@/lib/stromkonto-shared";
import { formatYieldKwh } from "@/lib/format";
import { hideSimulatedStore } from "@/lib/hide-simulated";
import { ThemeModeSetting } from "@/components/pv/theme-toggle";
import { pvStore } from "@/lib/pv-store";
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
  location: { plz: string; name: string; latitude: number; longitude: number };
  isCustom: boolean;
}) {
  const [plz, setPlz] = useState(location.plz || "");
  const [localities, setLocalities] = useState<PlzLocality[]>([]);
  const [selectedName, setSelectedName] = useState(location.name);
  const [plzLoading, setPlzLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    if (plz.length !== 4) {
      setLocalities([]);
      return;
    }

    let cancelled = false;
    setPlzLoading(true);
    setLocationError(null);

    void fetch(`/api/plz?zip=${encodeURIComponent(plz)}`, { cache: "no-store" })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof body === "object" &&
            body != null &&
            "error" in body &&
            typeof (body as { error: unknown }).error === "string"
              ? (body as { error: string }).error
              : "PLZ nicht gefunden";
          throw new Error(message);
        }
        return body as PlzLookupResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setLocalities(data.localities);
        if (data.localities.some((entry) => entry.name === selectedName)) return;
        const preferred = data.localities.find((entry) => entry.name === location.name);
        setSelectedName(preferred?.name ?? data.localities[0]?.name ?? "");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLocalities([]);
        setLocationError(
          error instanceof Error ? error.message : "PLZ-Abfrage fehlgeschlagen.",
        );
      })
      .finally(() => {
        if (!cancelled) setPlzLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [plz, location.name]);

  function handleSaveLocation() {
    if (!/^\d{4}$/.test(plz.trim())) {
      setLocationError("Bitte eine gültige vierstellige Schweizer PLZ eingeben.");
      return;
    }
    const entry = localities.find((item) => item.name === selectedName);
    if (!entry) {
      setLocationError("Bitte zuerst PLZ laden und einen Ort wählen.");
      return;
    }
    siteLocationStore.save({
      plz: plz.trim(),
      name: entry.name,
      latitude: entry.latitude,
      longitude: entry.longitude,
    });
    setLocationError(null);
  }

  function handleResetLocation() {
    siteLocationStore.resetToDefault();
    setLocationError(null);
  }

  const selectedLocality = localities.find((entry) => entry.name === selectedName);

  return (
    <SettingsSection
      icon={<MapPin className="size-4" />}
      iconClassName="bg-chart-2/12 text-chart-2"
      title="Standort"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Wetter und Sonnenzeiten kommen von Wetter-Alarm. Wähle PLZ und Ort aus dem
        Schweizer PLZ-Verzeichnis. Standard: PLZ {DEFAULT_SITE_LOCATION.plz}{" "}
        {DEFAULT_SITE_LOCATION.name}.
        {isCustom ? " Du verwendest einen angepassten Standort." : null}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="site-plz">PLZ</Label>
        <input
          id="site-plz"
          type="text"
          inputMode="numeric"
          maxLength={4}
          className={inputClassName}
          value={plz}
          onChange={(e) => setPlz(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="3315"
        />
      </div>

      {plz.length === 4 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="site-locality">Ort</Label>
          {localities.length > 1 ? (
            <select
              id="site-locality"
              className={inputClassName}
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              disabled={plzLoading || localities.length === 0}
            >
              {localities.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name} ({entry.canton})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm font-medium">
              {plzLoading
                ? "Orte werden geladen …"
                : selectedLocality
                  ? `${selectedLocality.name} (${selectedLocality.canton})`
                  : "–"}
            </p>
          )}
        </div>
      ) : null}

      {locationError ? <p className="text-xs text-destructive">{locationError}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleSaveLocation}>
          Standort speichern
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleResetLocation}>
          Standard ({DEFAULT_SITE_LOCATION.plz} {DEFAULT_SITE_LOCATION.name})
        </Button>
      </div>
    </SettingsSection>
  );
}

function StromkontoEditor() {
  const [balanceInput, setBalanceInput] = useState(String(DEFAULT_STROMKONTO_BALANCE_KWH));
  const [todayInput, setTodayInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingToday, setSavingToday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/stromkonto");
        if (!response.ok) throw new Error("Laden fehlgeschlagen");
        const data: { balanceKwh: number; todayChangeKwh: number | null } = await response.json();
        if (!cancelled) {
          setBalanceInput(String(data.balanceKwh));
          setTodayInput(data.todayChangeKwh == null ? "" : String(data.todayChangeKwh));
        }
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

  async function handleSaveToday() {
    const todayChangeKwh = parseStromkontoBalanceInput(todayInput);
    if (todayChangeKwh == null) {
      setError("Bitte einen Tageswert eingeben, z. B. -1.4 oder 0.8.");
      setSuccess(null);
      return;
    }

    setSavingToday(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/stromkonto", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todayChangeKwh }),
      });
      const data: { todayChangeKwh?: number; anchored?: boolean; error?: string } =
        await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Speichern fehlgeschlagen");
      }
      setTodayInput(String(data.todayChangeKwh));
      setSuccess(
        data.anchored
          ? "Tageswert gespeichert. Weitere Zählermessungen werden darauf addiert."
          : "Tageswert gespeichert. Anheftung an den Zähler erfolgt beim nächsten Messwert.",
      );
      pvStore.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSavingToday(false);
    }
  }

  return (
    <SettingsSection
      icon={<BatteryFull className="size-4 -rotate-90" />}
      iconClassName="bg-chart-3/12 text-chart-3"
      title="Stromkonto"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Gespeicherter Startstand in kWh. Er gilt ab sofort als Stand Stromkonto.
        {APP_NAME} addiert oder subtrahiert laufende Netto-Veränderungen
        (Einspeisung minus Bezug), sobald whatwatt Go misst.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stromkonto-balance">Basiskontostand (kWh)</Label>
        <input
          id="stromkonto-balance"
          type="text"
          inputMode="decimal"
          className={inputClassName}
          value={balanceInput}
          disabled={loading || saving || savingToday}
          onChange={(e) => setBalanceInput(e.target.value)}
          placeholder="516"
        />
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={loading || saving || savingToday}
        onClick={() => void handleSaveBalance()}
      >
        {saving ? "Speichern…" : "Basiskontostand speichern"}
      </Button>

      <div className="flex flex-col gap-1.5 border-t border-border/70 pt-4">
        <Label htmlFor="stromkonto-today">Tageswert heute (kWh)</Label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Positiv, wenn heute ins Konto eingezahlt wurde. Negativ, wenn bezogen
          wurde. Ab dem Speichern zählt whatwatt ab diesem Wert weiter.
        </p>
        <input
          id="stromkonto-today"
          type="text"
          inputMode="decimal"
          className={inputClassName}
          value={todayInput}
          disabled={loading || saving || savingToday}
          onChange={(e) => setTodayInput(e.target.value)}
          placeholder="z. B. -1.4"
        />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {success ? <p className="text-xs text-chart-3">{success}</p> : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={loading || saving || savingToday}
        onClick={() => void handleSaveToday()}
      >
        {savingToday ? "Speichern…" : "Tageswert speichern"}
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
  const hideSimulated = useSyncExternalStore(
    hideSimulatedStore.subscribe,
    hideSimulatedStore.getSnapshot,
    hideSimulatedStore.getServerSnapshot,
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
          <SettingsSection
            icon={<EyeOff className="size-4" />}
            iconClassName="bg-muted text-foreground/70"
            title="Anzeige"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor="hide-simulated">Simulierte Werte ausblenden</Label>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Ertrag, Verbrauch und Verläufe ohne FusionSolar bleiben leer. Gemessene
                  Netzwerte von whatwatt Go bleiben sichtbar.
                </span>
              </div>
              <Switch
                id="hide-simulated"
                checked={hideSimulated}
                onCheckedChange={(checked) => hideSimulatedStore.set(checked)}
                className="data-checked:bg-chart-3"
              />
            </div>
            <div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
              <span className="text-sm font-medium">Farbschema</span>
              <ThemeModeSetting />
            </div>
          </SettingsSection>

          <StromkontoEditor />

          <SiteLocationEditor
            key={`${location.plz}:${location.name}:${location.latitude}:${location.longitude}`}
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
            title="Über PV Dash"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Entstanden mit Cursor, Koffein und der Musik von Paul Kalkbrenner. Herbst
              2026.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Anbindung:
              <br />
              whatwatt via MQTT und HiveMQ als Broker
              <br />
              FusionSolar via API
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Externe Datenquellen:
              <br />
              <a
                href="https://wetteralarm.ch/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Wetter-Alarm
              </a>
              : Wetterdaten
              <br />
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Open-Meteo
              </a>
              : Solare Ertragsprognose (GTI, PR 0,78).
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Die Applikation wird in den Schweizer Rechenzentren von Infomaniak mit
              Hauptsitz in Genf gehostet. Der unabhängige Cloud-Anbieter betreibt seine
              gesamte Infrastruktur zu 100&nbsp;% mit erneuerbarer Energie.
            </p>
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
