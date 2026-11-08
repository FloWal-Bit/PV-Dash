"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronRight,
  EyeOff,
  Info,
  RefreshCcw,
  Smartphone,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { hideSimulatedStore } from "@/lib/hide-simulated";
import { infoBannerStore } from "@/lib/info-banner";
import {
  MAX_INFO_BANNER_LENGTH,
  isoToZurichDatetimeLocal,
  normalizeInfoBanner,
  normalizeInfoBannerSchedule,
  zurichDatetimeLocalToIso,
} from "@/lib/dev-settings-shared";
import {
  DeveloperPlantSettings,
  PushNotificationSettings,
  SettingsSection,
} from "@/components/pv/settings-dialog";
import { pvStore } from "@/lib/pv-store";
import { readDeviceId, reportDeviceVisit } from "@/lib/device-visit";
import {
  shortDeviceId,
  type DeviceLogSummary,
  type DeviceVisit,
} from "@/lib/device-log-shared";
import { cn } from "@/lib/utils";

export function BacklogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (
    open: boolean,
    eventDetails: { reason: string; event: Event; cancel: () => void },
  ) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={panelRef}
        // Sonst landet der Fokus im Info-Banner-Textarea (Caret/Tastatur).
        initialFocus={panelRef}
        className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <div className="border-b border-border/70 bg-muted/40 px-5 py-4">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg">Dev Settings</DialogTitle>
          </DialogHeader>
        </div>

        <div className="flex max-h-[min(70dvh,36rem)] flex-col gap-3 overflow-y-auto px-5 py-4">
          <DeviceLogSection open={open} />
          <InfoBannerEditor />
          <PushNotificationSettings />
          <DeveloperPlantSettings />
          <HideSimulatedToggle />
          {process.env.NODE_ENV === "development" ? <DevFusionRefresh /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SEEN_TIME_ZONE = "Europe/Zurich";

function zurichDayKey(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: SEEN_TIME_ZONE });
}

/** Kalendertag und Vortag in Europe/Zurich als `YYYY-MM-DD`. */
function zurichTodayAndYesterday(now = new Date()): { today: string; yesterday: string } {
  const today = now.toLocaleDateString("en-CA", { timeZone: SEEN_TIME_ZONE });
  const [year, month, day] = today.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day));
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  return { today, yesterday };
}

function formatSeenTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleTimeString("de-CH", {
    timeZone: SEEN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSeenOlder(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  const day = date.toLocaleDateString("de-CH", {
    timeZone: SEEN_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
  });
  return `${day}, ${formatSeenTime(iso)}`;
}

function groupDevicesByRecency(devices: DeviceVisit[], now = new Date()) {
  const { today, yesterday } = zurichTodayAndYesterday(now);
  const todayDevices: DeviceVisit[] = [];
  const yesterdayDevices: DeviceVisit[] = [];
  const olderDevices: DeviceVisit[] = [];
  for (const device of devices) {
    const day = zurichDayKey(device.lastSeen);
    if (day === today) todayDevices.push(device);
    else if (day === yesterday) yesterdayDevices.push(device);
    else olderDevices.push(device);
  }
  return { todayDevices, yesterdayDevices, olderDevices };
}

function DeviceRow({
  device,
  currentDeviceId,
  when,
}: {
  device: DeviceVisit;
  currentDeviceId: string | null;
  when: string;
}) {
  const isCurrent = device.id === currentDeviceId;
  return (
    <li className="flex flex-col gap-0.5 border-b border-border/40 py-2 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug break-words">
          {device.label}
        </p>
        <span className="shrink-0 pt-0.5 tabular-nums text-xs text-muted-foreground">{when}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        {isCurrent ? (
          <span className="font-medium text-chart-3">Dieses Gerät</span>
        ) : null}
        {device.version ? <span className="tabular-nums">v{device.version}</span> : null}
        <span className="font-mono tabular-nums opacity-70" title={device.id}>
          #{shortDeviceId(device.id)}
        </span>
      </div>
    </li>
  );
}

function DeviceGroup({
  title,
  devices,
  currentDeviceId,
  formatWhen,
}: {
  title: string;
  devices: DeviceVisit[];
  currentDeviceId: string | null;
  formatWhen: (iso: string) => string;
}) {
  if (devices.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="flex flex-col">
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            currentDeviceId={currentDeviceId}
            when={formatWhen(device.lastSeen)}
          />
        ))}
      </ul>
    </div>
  );
}

/** Eingeklappte Gerätegruppe (Gestern / Älter). */
function CollapsibleDeviceGroup({
  label,
  devices,
  currentDeviceId,
  formatWhen,
}: {
  label: string;
  devices: DeviceVisit[];
  currentDeviceId: string | null;
  formatWhen: (iso: string) => string;
}) {
  if (devices.length === 0) return null;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        {label} ({devices.length})
      </summary>
      <ul className="mt-1 flex flex-col border-t border-border/60 pt-1">
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            currentDeviceId={currentDeviceId}
            when={formatWhen(device.lastSeen)}
          />
        ))}
      </ul>
    </details>
  );
}

function DeviceLogSection({ open }: { open: boolean }) {
  const [summary, setSummary] = useState<DeviceLogSummary | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await reportDeviceVisit();
      if (cancelled) return;
      const id = readDeviceId();
      try {
        const response = await fetch("/api/device-log", { cache: "no-store" });
        if (!response.ok) throw new Error("Geräte konnten nicht geladen werden.");
        const data = (await response.json()) as DeviceLogSummary;
        if (cancelled) return;
        setDeviceId(id);
        setSummary(data);
        setError(null);
      } catch {
        if (cancelled) return;
        setDeviceId(id);
        setError("Geräte konnten nicht geladen werden.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const groups = summary ? groupDevicesByRecency(summary.devices) : null;
  const count = summary?.count ?? 0;

  return (
    <SettingsSection
      icon={<Smartphone className="size-4" />}
      iconClassName="bg-chart-2/12 text-chart-2"
      title="Geräte"
    >
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!summary && !error ? (
        <p className="text-xs text-muted-foreground">Geräte werden geladen…</p>
      ) : null}
      {summary && count === 0 ? (
        <p className="text-xs text-muted-foreground">Noch kein Aufruf.</p>
      ) : null}
      {summary && groups && count > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs tabular-nums text-muted-foreground">
            {count} {count === 1 ? "Gerät" : "Geräte"}
            {" · "}
            {groups.todayDevices.length} heute
            {" · "}
            {groups.yesterdayDevices.length} gestern
            {groups.olderDevices.length > 0
              ? ` · ${groups.olderDevices.length} älter`
              : null}
          </p>

          <DeviceGroup
            title="Heute"
            devices={groups.todayDevices}
            currentDeviceId={deviceId}
            formatWhen={formatSeenTime}
          />
          <CollapsibleDeviceGroup
            label="Gestern"
            devices={groups.yesterdayDevices}
            currentDeviceId={deviceId}
            formatWhen={formatSeenTime}
          />
          <CollapsibleDeviceGroup
            label="Älter"
            devices={groups.olderDevices}
            currentDeviceId={deviceId}
            formatWhen={formatSeenOlder}
          />
        </div>
      ) : null}
    </SettingsSection>
  );
}

function InfoBannerEditor() {
  const saved = useSyncExternalStore(
    infoBannerStore.subscribe,
    infoBannerStore.getSnapshot,
    infoBannerStore.getServerSnapshot,
  );
  const savedSchedule = useSyncExternalStore(
    infoBannerStore.subscribeSchedule,
    infoBannerStore.getScheduleSnapshot,
    infoBannerStore.getScheduleServerSnapshot,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const [draftUntil, setDraftUntil] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const value = draft ?? saved;
  const fromLocal = draftFrom ?? isoToZurichDatetimeLocal(savedSchedule.visibleFrom);
  const untilLocal = draftUntil ?? isoToZurichDatetimeLocal(savedSchedule.visibleUntil);
  const dirty =
    value !== saved ||
    fromLocal !== isoToZurichDatetimeLocal(savedSchedule.visibleFrom) ||
    untilLocal !== isoToZurichDatetimeLocal(savedSchedule.visibleUntil);

  async function save() {
    if (savingRef.current) return;
    let nextText = value;
    let visibleFrom: string | null = null;
    let visibleUntil: string | null = null;
    try {
      nextText = normalizeInfoBanner(value);
      if (fromLocal.trim()) {
        visibleFrom = zurichDatetimeLocalToIso(fromLocal);
        if (!visibleFrom) throw new Error("Ungültiger Startzeitpunkt.");
      }
      if (untilLocal.trim()) {
        visibleUntil = zurichDatetimeLocalToIso(untilLocal);
        if (!visibleUntil) throw new Error("Ungültiger Endzeitpunkt.");
      }
      normalizeInfoBannerSchedule(visibleFrom, visibleUntil);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hinweis konnte nicht gespeichert werden.");
      return;
    }
    if (
      nextText === saved &&
      visibleFrom === savedSchedule.visibleFrom &&
      visibleUntil === savedSchedule.visibleUntil
    ) {
      setDraft(null);
      setDraftFrom(null);
      setDraftUntil(null);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await infoBannerStore.set({
        text: nextText,
        visibleFrom,
        visibleUntil,
      });
      setDraft(null);
      setDraftFrom(null);
      setDraftUntil(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hinweis konnte nicht gespeichert werden.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      icon={<Info className="size-4" />}
      iconClassName="bg-chart-3/12 text-chart-3"
      title="Info-Banner"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Steht oberhalb der Wetterkarte. Die Karte wird so hoch, wie der Text braucht.
        Leer lassen blendet den Hinweis aus. Optional zeitlich begrenzen (Europe/Zurich).
      </p>
      <textarea
        className="flex min-h-24 w-full resize-y rounded-xl border border-border/80 bg-background px-3 py-2 text-sm leading-relaxed shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-chart-3 focus-visible:ring-[3px] focus-visible:ring-chart-3/25 disabled:cursor-not-allowed disabled:opacity-60"
        value={value}
        maxLength={MAX_INFO_BANNER_LENGTH}
        disabled={saving}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        placeholder="Hinweis für das Dashboard…"
        aria-label="Text des Info-Banners"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Sichtbar ab
          <input
            type="datetime-local"
            className="h-9 rounded-xl border border-border/80 bg-background px-3 text-sm text-card-foreground outline-none focus-visible:border-chart-3 focus-visible:ring-[3px] focus-visible:ring-chart-3/25 disabled:opacity-60"
            value={fromLocal}
            disabled={saving}
            onChange={(event) => {
              setDraftFrom(event.target.value);
              if (error) setError(null);
            }}
            aria-label="Info-Banner sichtbar ab"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Sichtbar bis
          <input
            type="datetime-local"
            className="h-9 rounded-xl border border-border/80 bg-background px-3 text-sm text-card-foreground outline-none focus-visible:border-chart-3 focus-visible:ring-[3px] focus-visible:ring-chart-3/25 disabled:opacity-60"
            value={untilLocal}
            disabled={saving}
            onChange={(event) => {
              setDraftUntil(event.target.value);
              if (error) setError(null);
            }}
            aria-label="Info-Banner sichtbar bis"
          />
        </label>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Leer = ohne Begrenzung. Das Banner erscheint nur innerhalb des Fensters; der Text bleibt
        gespeichert.
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {value.length}/{MAX_INFO_BANNER_LENGTH}
        </span>
        <Button type="button" variant="secondary" size="sm" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? "…" : "Speichern"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </SettingsSection>
  );
}

function HideSimulatedToggle() {
  const hideSimulated = useSyncExternalStore(
    hideSimulatedStore.subscribe,
    hideSimulatedStore.getSnapshot,
    hideSimulatedStore.getServerSnapshot,
  );

  return (
    <SettingsSection
      icon={<EyeOff className="size-4" />}
      iconClassName="bg-muted text-foreground/70"
      title="Simulierte Werte ausblenden"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs leading-relaxed text-muted-foreground">
          Ertrag, Verbrauch und Verläufe ohne FusionSolar bleiben leer. Gemessene Netzwerte
          von whatwatt Go bleiben sichtbar.
        </span>
        <Switch
          id="hide-simulated"
          aria-label="Simulierte Werte ausblenden"
          checked={hideSimulated}
          onCheckedChange={(checked) => hideSimulatedStore.set(checked)}
          className="data-checked:bg-chart-3"
        />
      </div>
    </SettingsSection>
  );
}

function DevFusionRefresh() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function reload() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/pv/dev-refresh", { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setFailed(true);
        setMessage(body.error ?? "Nachladen fehlgeschlagen.");
        return;
      }
      pvStore.reload();
      setFailed(false);
      setMessage("Gespeichert. Weitere Abrufe lesen nur noch diese Daten.");
    } catch {
      setFailed(true);
      setMessage("Nachladen fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsSection
      icon={<RefreshCcw className="size-4" />}
      iconClassName="bg-muted text-foreground/70"
      title="FusionSolar nachladen"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Einmal von Huawei holen und lokal behalten.
        </p>
        <Button type="button" variant="secondary" size="sm" className="shrink-0" disabled={pending} onClick={() => void reload()}>
          {pending ? "…" : "Nachladen"}
        </Button>
      </div>
      {message ? (
        <p className={cn("text-xs", failed ? "text-destructive" : "text-muted-foreground")}>{message}</p>
      ) : null}
    </SettingsSection>
  );
}

