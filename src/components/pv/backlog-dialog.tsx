"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Check, ListTodo, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { backlogStore } from "@/lib/backlog-store";
import { MAX_BACKLOG_TITLE_LENGTH } from "@/lib/backlog-shared";
import { cn } from "@/lib/utils";

const inputClassName =
  "flex h-10 min-w-0 flex-1 rounded-xl border border-border/80 bg-background px-3 py-2 text-sm shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-chart-3 focus-visible:ring-[3px] focus-visible:ring-chart-3/25 disabled:cursor-not-allowed disabled:opacity-60";

export function BacklogDialog() {
  const { items, loading, error } = useSyncExternalStore(
    backlogStore.subscribe,
    backlogStore.getSnapshot,
    backlogStore.getServerSnapshot,
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openCount = items.filter((item) => !item.done).length;
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
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative rounded-full"
            aria-label="Backlog"
          />
        }
      >
        <ListTodo className="size-4" />
        {openCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-chart-3 px-1 text-[9px] font-semibold text-white">
            {openCount > 9 ? "9+" : openCount}
          </span>
        ) : null}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="border-b border-border/70 bg-muted/40 px-5 py-4">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg">Backlog</DialogTitle>
            <DialogDescription>
              Ideen für PV Dash schnell einkippen. Offene Punkte bleiben gespeichert,
              bis du sie erledigst oder löschst.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form
          onSubmit={(event) => void handleAdd(event)}
          className="flex items-center gap-2 border-b border-border/70 px-5 py-3"
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
          <Button type="submit" variant="secondary" size="sm" disabled={saving}>
            <Plus className="size-3.5" />
            {saving ? "…" : "Hinzufügen"}
          </Button>
        </form>

        <div className="flex max-h-[min(60dvh,28rem)] flex-col gap-3 overflow-y-auto px-5 py-4">
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
        </div>
      </DialogContent>
    </Dialog>
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
