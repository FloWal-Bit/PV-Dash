"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { BatteryFull, Bell, Check, EyeOff, Info, MapPin, Settings2, Smartphone, Zap } from "lucide-react";
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
import { siteLocationStore } from "@/lib/site-location";
import {
  parseYieldForecastInput,
  yieldForecastStore,
} from "@/lib/yield-forecast-settings";
import {
  DEFAULT_STROMKONTO_BALANCE_KWH,
  parseStromkontoBalanceInput,
} from "@/lib/stromkonto-shared";
import { formatSignedKwh, formatSwissNumber, formatYieldKwh } from "@/lib/format";
import {
  ENERGY_FLOW_DEFAULT_TAB_LABELS,
  type EnergyFlowDefaultTab,
  energyFlowDefaultTabStore,
} from "@/lib/energy-flow-default-tab";
import { hideStatusBarStore, setHideStatusBar } from "@/lib/status-bar";
import { canUseHaptics, hapticsEnabledStore, triggerHaptic } from "@/lib/haptics";
import { ThemeModeSetting } from "@/components/pv/theme-toggle";
import {
  canPromptInstall,
  getHomeScreenInstallServerState,
  getHomeScreenInstallState,
  homeScreenHint,
  isAndroidBrowser,
  isIosBrowser,
  promptHomeScreenInstall,
  subscribeHomeScreenInstall,
} from "@/lib/install-prompt";
import { APP_NAME } from "@/lib/version";
import { cn } from "@/lib/utils";

const inputClassName =
  "flex h-10 w-full rounded-xl border border-border/80 bg-background px-3 py-2 text-sm shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-chart-3 focus-visible:ring-[3px] focus-visible:ring-chart-3/25 disabled:cursor-not-allowed disabled:opacity-60";

function StatusBarSwitch() {
  const hideStatusBar = useSyncExternalStore(
    hideStatusBarStore.subscribe,
    hideStatusBarStore.getSnapshot,
    hideStatusBarStore.getServerSnapshot,
  );

  return (
    <Switch
      id="hide-status-bar"
      checked={hideStatusBar}
      onCheckedChange={(checked) => {
        void setHideStatusBar(checked);
      }}
      className="data-checked:bg-chart-3"
    />
  );
}

function HapticsSwitch() {
  const enabled = useSyncExternalStore(
    hapticsEnabledStore.subscribe,
    hapticsEnabledStore.getSnapshot,
    hapticsEnabledStore.getServerSnapshot,
  );

  return (
    <Switch
      id="haptics-enabled"
      checked={enabled}
      onCheckedChange={(checked) => {
        hapticsEnabledStore.setEnabled(checked);
        // Direkt im Tipp: Testimpuls, damit klar ist, ob Vibration funktioniert.
        if (checked) triggerHaptic("confirm");
      }}
      className="data-checked:bg-chart-3"
    />
  );
}

function AndroidHapticsSetting() {
  const [android, setAndroid] = useState(false);
  const [vibrateApi, setVibrateApi] = useState(false);
  useEffect(() => {
    setAndroid(isAndroidBrowser());
    setVibrateApi(canUseHaptics());
  }, []);
  if (!android) return null;

  return (
    <div className="flex items-start justify-between gap-3 border-t border-border/70 pt-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor="haptics-enabled">Haptisches Feedback</Label>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {vibrateApi
            ? "Standardmässig aus. Vibration beim Wechseln der Tabs und beim Scrubben in den Diagrammen. System-Vibration muss aktiv sein."
            : "Dieses Gerät meldet keine Vibration-API — Haptik ist hier nicht verfügbar."}
        </span>
      </div>
      <HapticsSwitch />
    </div>
  );
}

function EnergyFlowDefaultTabSetting() {
  const tab = useSyncExternalStore(
    energyFlowDefaultTabStore.subscribe,
    energyFlowDefaultTabStore.getSnapshot,
    energyFlowDefaultTabStore.getServerSnapshot,
  );

  return (
    <div role="radiogroup" aria-label="Startansicht" className="flex flex-col gap-1">
      {([1, 2] as const).map((option) => {
        const selected = option === tab;
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
            onClick={() => energyFlowDefaultTabStore.set(option)}
          >
            <span className="min-w-0 flex-1 leading-snug">
              {ENERGY_FLOW_DEFAULT_TAB_LABELS[option as EnergyFlowDefaultTab]}
            </span>
            {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function HomeScreenSetting() {
  const { installed, canInstall, ios } = useSyncExternalStore(
    subscribeHomeScreenInstall,
    getHomeScreenInstallState,
    getHomeScreenInstallServerState,
  );
  const [accepted, setAccepted] = useState(false);
  const [manualHint, setManualHint] = useState<string | null>(null);

  async function handleInstall() {
    const outcome = await promptHomeScreenInstall();
    if (outcome === "accepted") {
      setAccepted(true);
      return;
    }
    if (!isIosBrowser() && !canPromptInstall()) setManualHint(homeScreenHint());
  }

  if (installed || accepted) return null;

  const showButton = canInstall || !ios;
  const hint = canInstall ? null : ios ? homeScreenHint() : manualHint;

  return (
    <SettingsSection
      icon={<Smartphone className="size-4" />}
      iconClassName="bg-muted text-foreground/70"
      title="App installieren"
    >
      <div className="flex flex-col items-start gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Installiert PV Dash auf dem Gerät. Danach startet PV Dash ohne Browserleiste.
        </p>
        {showButton ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void handleInstall()}>
            Als App installieren
          </Button>
        ) : null}
        {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      </div>
    </SettingsSection>
  );
}

export function SettingsSection({
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

  const selectedLocality = localities.find((entry) => entry.name === selectedName);

  return (
    <SettingsSection
      icon={<MapPin className="size-4" />}
      iconClassName="bg-chart-2/12 text-chart-2"
      title="Standort"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Wetter und Sonnenzeiten kommen von Wetter-Alarm. Wähle PLZ und Ort aus dem
        Schweizer PLZ-Verzeichnis.
        {isCustom ? " Du verwendest einen angepassten Standort." : null}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="site-plz">PLZ</Label>
        <div className="flex items-center gap-2">
          <input
            id="site-plz"
            type="text"
            inputMode="numeric"
            maxLength={4}
            className={cn(inputClassName, "min-w-0 flex-1")}
            value={plz}
            onChange={(e) => setPlz(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="3315"
          />
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={handleSaveLocation}>
            Standort speichern
          </Button>
        </div>
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
    </SettingsSection>
  );
}

type AboEndForecastDto = {
  balanceKwh: number;
  periodEndsOn: string;
  accountYear: number;
  computedAt: string;
  avgDailyNetKwh: number;
  remainingDays: number;
  projectedNetKwh: number;
  basisYieldKwh: number;
  basisConsumptionKwh: number;
  basisDays: number;
  methodLabel: string;
};

function formatForecastComputedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAboPeriodEnd(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function StromkontoEditor() {
  const [balanceInput, setBalanceInput] = useState(String(DEFAULT_STROMKONTO_BALANCE_KWH));
  const [todayInput, setTodayInput] = useState("0");
  const [aboEndForecast, setAboEndForecast] = useState<AboEndForecastDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBalance, setSavingBalance] = useState(false);
  const [savingToday, setSavingToday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/stromkonto");
        if (!response.ok) throw new Error("Laden fehlgeschlagen");
        const data: {
          balanceKwh: number;
          todayChangeKwh: number | null;
          aboEndForecast?: AboEndForecastDto | null;
        } = await response.json();
        if (!cancelled) {
          setBalanceInput(String(data.balanceKwh));
          setTodayInput(
            data.todayChangeKwh == null ? "0" : String(data.todayChangeKwh),
          );
          setAboEndForecast(data.aboEndForecast ?? null);
        }
      } catch {
        if (!cancelled) {
          setError("Stromkonto-Werte konnten nicht geladen werden.");
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

    setSavingBalance(true);
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
      setSavingBalance(false);
    }
  }

  async function handleSaveToday() {
    const todayChangeKwh = parseStromkontoBalanceInput(todayInput);
    if (todayChangeKwh == null) {
      setError("Bitte einen gültigen Tageswert in kWh eingeben (z. B. 12.5 oder -3).");
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
          ? "Stromkonto heute gespeichert und an aktuelle Zählerstände angeheftet."
          : "Stromkonto heute gespeichert. Anheftung erfolgt beim nächsten whatwatt-Messwert.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSavingToday(false);
    }
  }

  const busy = loading || savingBalance || savingToday;

  return (
    <SettingsSection
      icon={<BatteryFull className="size-4 -rotate-90" />}
      iconClassName="bg-chart-3/12 text-chart-3"
      title="Stromkonto"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        {APP_NAME} addiert oder subtrahiert laufende Netto-Veränderungen
        (Einspeisung minus Bezug), sobald whatwatt Go misst. Als Basis muss
        einmalig der mit der Stromkonto App abgestimmte Kontostand übertragen
        werden. Dies geschieht idealerweise in Zeiten wo kaum Einspeisung oder
        Bezug bestehen.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stromkonto-balance">Basiskontostand / Total (kWh)</Label>
        <div className="flex items-center gap-2">
          <input
            id="stromkonto-balance"
            type="text"
            inputMode="decimal"
            className={cn(inputClassName, "min-w-0 flex-1")}
            value={balanceInput}
            disabled={busy}
            onChange={(e) => setBalanceInput(e.target.value)}
            placeholder="516"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void handleSaveBalance()}
          >
            {savingBalance ? "Speichern…" : "Total speichern"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stromkonto-today">Stromkonto heute (kWh)</Label>
        <div className="flex items-center gap-2">
          <input
            id="stromkonto-today"
            type="text"
            inputMode="decimal"
            className={cn(inputClassName, "min-w-0 flex-1")}
            value={todayInput}
            disabled={busy}
            onChange={(e) => setTodayInput(e.target.value)}
            placeholder="0"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void handleSaveToday()}
          >
            {savingToday ? "Speichern…" : "Heute speichern"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
        <p className="text-xs font-medium text-card-foreground">
          Prognose Kontostand Abo-Ende
          {aboEndForecast ? ` ${formatAboPeriodEnd(aboEndForecast.periodEndsOn)}` : ""}
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Berechne…</p>
        ) : aboEndForecast ? (
          <>
            <p className="text-lg font-semibold tabular-nums text-card-foreground">
              {formatSignedKwh(aboEndForecast.balanceKwh, 1)}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Rest laut Monatsprofil {formatSignedKwh(aboEndForecast.projectedNetKwh, 0)} (
              {formatYieldKwh(aboEndForecast.basisYieldKwh, 0)} Ertrag /{" "}
              {formatYieldKwh(aboEndForecast.basisConsumptionKwh, 0)} Verbrauch) · Mittel{" "}
              {formatSignedKwh(aboEndForecast.avgDailyNetKwh, 2)}/Tag · noch{" "}
              {aboEndForecast.remainingDays} Tage bis zur Nullung
              {aboEndForecast.methodLabel ? ` · ${aboEndForecast.methodLabel}` : ""}. Wird ca.
              2× täglich neu berechnet
              {aboEndForecast.computedAt
                ? ` · Stand ${formatForecastComputedAt(aboEndForecast.computedAt)}`
                : ""}
              .
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Prognose derzeit nicht verfügbar (Ertrags-/Verbrauchsdaten fehlen).
          </p>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Positiv = Einspeisung überwiegt, negativ = Bezug. Ab dem Speichern zählt
        whatwatt weiter dazu. Ohne manuellen Wert startet „heute“ um 00:00 Uhr
        Schweizer Zeit bei 0. Der Totalkontostand wird in der Nacht vom 3. auf
        den 4. August auf 0 gesetzt und zählt ab dann neu.
      </p>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {success ? <p className="text-xs text-chart-3">{success}</p> : null}
    </SettingsSection>
  );
}

function YieldForecastEditor() {
  const plant = useSyncExternalStore(
    yieldForecastStore.subscribe,
    yieldForecastStore.getSnapshot,
    yieldForecastStore.getServerSnapshot,
  );
  const [latitude, setLatitude] = useState(String(plant.latitude));
  const [longitude, setLongitude] = useState(String(plant.longitude));
  const [tilt, setTilt] = useState(String(plant.tiltDeg));
  const [azimuth, setAzimuth] = useState(String(plant.azimuthDeg));
  const [peakKwp, setPeakKwp] = useState(String(plant.peakKwp));
  const [performanceRatio, setPerformanceRatio] = useState(String(plant.performanceRatio));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setLatitude(String(plant.latitude));
    setLongitude(String(plant.longitude));
    setTilt(String(plant.tiltDeg));
    setAzimuth(String(plant.azimuthDeg));
    setPeakKwp(String(plant.peakKwp));
    setPerformanceRatio(String(plant.performanceRatio));
  }, [plant]);

  async function handleSave() {
    const next = {
      latitude: parseYieldForecastInput(latitude),
      longitude: parseYieldForecastInput(longitude),
      tiltDeg: parseYieldForecastInput(tilt),
      azimuthDeg: parseYieldForecastInput(azimuth),
      peakKwp: parseYieldForecastInput(peakKwp),
      performanceRatio: parseYieldForecastInput(performanceRatio),
    };
    if (next.latitude == null || next.latitude < -90 || next.latitude > 90) {
      setError("Breite muss zwischen −90 und 90 liegen.");
      setSuccess(null);
      return;
    }
    if (next.longitude == null || next.longitude < -180 || next.longitude > 180) {
      setError("Länge muss zwischen −180 und 180 liegen.");
      setSuccess(null);
      return;
    }
    if (next.tiltDeg == null || next.tiltDeg < 0 || next.tiltDeg > 90) {
      setError("Neigung muss zwischen 0 und 90 Grad liegen.");
      setSuccess(null);
      return;
    }
    if (next.azimuthDeg == null || next.azimuthDeg < -180 || next.azimuthDeg > 180) {
      setError("Azimut muss zwischen −180 und 180 Grad liegen.");
      setSuccess(null);
      return;
    }
    if (next.peakKwp == null || next.peakKwp <= 0 || next.peakKwp > 1000) {
      setError("Leistung muss grösser als 0 und höchstens 1000 kWp sein.");
      setSuccess(null);
      return;
    }
    if (next.performanceRatio == null || next.performanceRatio <= 0 || next.performanceRatio > 1.2) {
      setError("Leistungsfaktor muss grösser als 0 und höchstens 1.2 sein.");
      setSuccess(null);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // Geometrie lokal; PR auf dem Server für alle Clients.
      yieldForecastStore.save({
        latitude: next.latitude,
        longitude: next.longitude,
        tiltDeg: next.tiltDeg,
        azimuthDeg: next.azimuthDeg,
        peakKwp: next.peakKwp,
        performanceRatio: next.performanceRatio,
      });
      await yieldForecastStore.persistPerformanceRatio(next.performanceRatio);
      const { pvStore } = await import("@/lib/pv-store");
      pvStore.reload();
      setSuccess(
        "Gespeichert. Der Leistungsfaktor gilt für alle Geräte; die Prognose wird neu berechnet.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      icon={<Zap className="size-4" />}
      iconClassName="bg-chart-1/12 text-chart-1"
      title="Ertragsprognose"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Stundenweise Einstrahlung am Standort, mal Leistung, mal Leistungsfaktor. Neigung
        beschreibt die Module, Azimut 0° ist Süden. Der Leistungsfaktor liegt auf dem Server und
        gilt für alle Geräte.
      </p>
      <ForecastField id="forecast-lat" label="Breite" value={latitude} onChange={setLatitude} />
      <ForecastField id="forecast-lon" label="Länge" value={longitude} onChange={setLongitude} />
      <ForecastField id="forecast-tilt" label="Neigung (°)" value={tilt} onChange={setTilt} />
      <ForecastField id="forecast-azimuth" label="Azimut (°)" value={azimuth} onChange={setAzimuth} />
      <ForecastField id="forecast-kwp" label="Leistung (kWp)" value={peakKwp} onChange={setPeakKwp} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="forecast-pr">Leistungsfaktor (PR)</Label>
        <div className="flex items-center gap-2">
          <input
            id="forecast-pr"
            type="text"
            inputMode="decimal"
            className={cn(inputClassName, "min-w-0 flex-1")}
            value={performanceRatio}
            disabled={saving}
            onChange={(event) => {
              setPerformanceRatio(event.target.value);
              setSuccess(null);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "…" : "Prognose speichern"}
          </Button>
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {success ? <p className="text-xs text-chart-3">{success}</p> : null}
    </SettingsSection>
  );
}

function ForecastField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className={inputClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Push-Benachrichtigungen, nur in den Dev-Einstellungen. */
export function PushNotificationSettings() {
  const { enabled, permission } = useSyncExternalStore(
    notificationSettingsStore.subscribe,
    notificationSettingsStore.getSnapshot,
    notificationSettingsStore.getServerSnapshot,
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
  );
}

/** Standort und Stromkonto, nur im versteckten Entwicklerbereich. */
export function DeveloperPlantSettings() {
  const { location, isCustom } = useSyncExternalStore(
    siteLocationStore.subscribe,
    siteLocationStore.getSnapshot,
    siteLocationStore.getServerSnapshot,
  );

  return (
    <div className="flex flex-col gap-3">
      <StromkontoEditor />
      <SiteLocationEditor
        key={`${location.plz}:${location.name}:${location.latitude}:${location.longitude}`}
        location={location}
        isCustom={isCustom}
      />
      <YieldForecastEditor />
    </div>
  );
}

/** Open-Meteo-Zeile mit PR aus den serverweiten Dev-Einstellungen. */
function AboutOpenMeteoSource() {
  const plant = useSyncExternalStore(
    yieldForecastStore.subscribe,
    yieldForecastStore.getSnapshot,
    yieldForecastStore.getServerSnapshot,
  );
  const pr = formatSwissNumber(plant.performanceRatio, 2);

  return (
    <>
      <a
        href="https://open-meteo.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Open-Meteo
      </a>
      : Solare Ertragsprognose (GTI, PR {pr}).
    </>
  );
}

/**
 * Einstellungen-Dialog: Anzeige und App installieren.
 * Standort, Stromkonto und Push-Benachrichtigungen liegen im Entwicklerbereich
 * (fünfmal auf «PV Dash» tippen).
 */
export function SettingsDialog() {
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
          <DialogHeader className="gap-0">
            <DialogTitle className="text-lg">Einstellungen</DialogTitle>
            <DialogDescription className="sr-only">
              Anzeige und Benachrichtigungen für {APP_NAME}.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex max-h-[min(70dvh,36rem)] flex-col gap-3 overflow-y-auto px-5 py-4">
          <HomeScreenSetting />

          <SettingsSection
            icon={<EyeOff className="size-4" />}
            iconClassName="bg-muted text-foreground/70"
            title="Anzeige"
          >
            <div
              data-status-bar-toggle
              className="flex items-start justify-between gap-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor="hide-status-bar">Statusleiste ausblenden</Label>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Blendet Uhrzeit und Akku aus (Vollbild). Nach dem Aufwachen versucht
                  die App erneut Vollbild; sonst reicht ein Tipp. Chrome kann dabei
                  kurz einen Hinweis zeigen. Auf dem iPhone/iPad nicht verfügbar.
                </span>
              </div>
              <StatusBarSwitch />
            </div>
            <AndroidHapticsSetting />
            <div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
              <span className="text-sm font-medium">Farbschema</span>
              <ThemeModeSetting />
            </div>
            <div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
              <span className="text-sm font-medium">Startansicht</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Dieser Tab wird auf der zweiten Card zuerst angezeigt.
              </span>
              <EnergyFlowDefaultTabSetting />
            </div>
          </SettingsSection>

          <SettingsSection
            icon={<Info className="size-4" />}
            iconClassName="bg-muted text-foreground/70"
            title="Über PV Dash"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Die Applikation wird in den Schweizer Rechenzentren von Infomaniak mit
              Hauptsitz in Genf gehostet. Der unabhängige Cloud-Anbieter betreibt seine
              gesamte Infrastruktur zu 100&nbsp;% mit erneuerbarer Energie.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Anbindung:
              <br />
              Stromkonto via MQTT und HiveMQ als Broker
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
              <AboutOpenMeteoSource />
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Florian Walther, Herbst 2026.
            </p>
          </SettingsSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
