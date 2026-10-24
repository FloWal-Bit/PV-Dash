"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Check, EyeOff, Info, ListTodo, Plus, RefreshCcw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { backlogStore } from "@/lib/backlog-store";
import { MAX_BACKLOG_TITLE_LENGTH } from "@/lib/backlog-shared";
import { hideSimulatedStore } from "@/lib/hide-simulated";
import { infoBannerStore } from "@/lib/info-banner";
import { MAX_INFO_BANNER_LENGTH, normalizeInfoBanner } from "@/lib/dev-settings-shared";
import {
  DeveloperPlantSettings,
  PushNotificationSettings,
  SettingsSection,
} from "@/components/pv/settings-dialog";
import { pvStore } from "@/lib/pv-store";
import { cn } from "@/lib/utils";

const inputClassName =
  "flex h-10 min-w-0 flex-1 rounded-xl border border-border/80 bg-background px-3 py-2 text-sm shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-chart-3 focus-visible:ring-[3px] focus-visible:ring-chart-3/25 disabled:cursor-not-allowed disabled:opacity-60";

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
  const { items, loading, error } = useSyncExternalStore(
    backlogStore.subscribe,
    backlogStore.getSnapshot,
    backlogStore.getServerSnapshot,
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openItems = items.filter((item) => !item.done);
  const doneItems = items.filter((item) => item.done);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) {
      setFormError("Bitte eine Idee eingeben.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await backlogStore.add(title);
      setDraft("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Idee konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="border-b border-border/70 bg-muted/40 px-5 py-4">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg">Dev Settings</DialogTitle>
          </DialogHeader>
        </div>

        <div className="flex max-h-[min(70dvh,36rem)] flex-col gap-3 overflow-y-auto px-5 py-4">
          <InfoBannerEditor />
          <SettingsSection
            icon={<ListTodo className="size-4" />}
            iconClassName="bg-chart-1/12 text-chart-1"
            title="Backlog"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Ideen für PV Dash schnell einkippen. Offene Punkte bleiben gespeichert,
              bis du sie erledigst oder löschst.
            </p>

            <form
              onSubmit={(event) => void handleAdd(event)}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                className={inputClassName}
                value={draft}
                maxLength={MAX_BACKLOG_TITLE_LENGTH}
                disabled={saving}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="Idee einkippen…"
                aria-label="Neue Backlog-Idee"
              />
              <Button type="submit" variant="secondary" size="sm" className="shrink-0" disabled={saving}>
                <Plus className="size-3.5" />
                {saving ? "…" : "Hinzufügen"}
              </Button>
            </form>

            {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            {loading ? (
              <p className="text-sm text-muted-foreground">Backlog wird geladen…</p>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center">
                <p className="text-sm font-medium">Noch keine Ideen</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tippe oben eine Idee ein und füge sie dem Backlog hinzu.
                </p>
              </div>
            ) : (
              <>
                {openItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Keine offenen Punkte.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {openItems.map((item) => (
                      <BacklogRow
                        key={item.id}
                        title={item.title}
                        done={false}
                        onToggle={() => void backlogStore.toggle(item.id, true)}
                        onRemove={() => void backlogStore.remove(item.id)}
                      />
                    ))}
                  </ul>
                )}

                {doneItems.length > 0 ? (
                  <div className="flex flex-col gap-2 pt-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Erledigt
                    </p>
                    <ul className="flex flex-col gap-2">
                      {doneItems.map((item) => (
                        <BacklogRow
                          key={item.id}
                          title={item.title}
                          done
                          onToggle={() => void backlogStore.toggle(item.id, false)}
                          onRemove={() => void backlogStore.remove(item.id)}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </SettingsSection>

          <PushNotificationSettings />
          <DeveloperPlantSettings />
          <HideSimulatedToggle />
          {process.env.NODE_ENV === "development" ? <DevFusionRefresh /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoBannerEditor() {
  const saved = useSyncExternalStore(
    infoBannerStore.subscribe,
    infoBannerStore.getSnapshot,
    infoBannerStore.getServerSnapshot,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const value = draft ?? saved;
  const dirty = value !== saved;

  async function save() {
    if (savingRef.current) return;
    let next = value;
    try {
      next = normalizeInfoBanner(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hinweis konnte nicht gespeichert werden.");
      return;
    }
    if (next === saved) {
      setDraft(null);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await infoBannerStore.set(next);
      setDraft(null);
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
        Leer lassen blendet den Hinweis aus.
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
        onBlur={() => {
          if (dirty) void save();
        }}
        placeholder="Hinweis für das Dashboard…"
        aria-label="Text des Info-Banners"
      />
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

function BacklogRow({
  title,
  done,
  onToggle,
  onRemove,
}: {
  title: string;
  done: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start gap-2 rounded-2xl border border-border/70 bg-card px-3 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={done ? "Als offen markieren" : "Als erledigt markieren"}
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
          done
            ? "border-chart-3 bg-chart-3 text-white"
            : "border-border bg-background hover:border-chart-3/70",
        )}
      >
        {done ? <Check className="size-3" /> : null}
      </button>
      <p
        className={cn(
          "min-w-0 flex-1 text-sm leading-snug",
          done && "text-muted-foreground line-through",
        )}
      >
        {title}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Eintrag löschen"
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
