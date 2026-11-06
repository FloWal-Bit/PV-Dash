/**
 * Hinweistext für das Banner oberhalb der Wetterkarte.
 * Der Text liegt in den Dev-Einstellungen und gilt für alle Geräte.
 * Optionales Zeitfenster (Sichtbar ab/bis) steuert die Anzeige.
 * Das Schliessen gilt nur auf diesem Gerät, bis der Text sich ändert.
 */

import {
  isInfoBannerActiveNow,
  type InfoBannerSchedule,
} from "@/lib/dev-settings-shared";

const TEXT_KEY = "pv-dash:info-banner";
const FROM_KEY = "pv-dash:info-banner-from";
const UNTIL_KEY = "pv-dash:info-banner-until";
const DISMISS_KEY = "pv-dash:info-banner-dismissed";

type Listener = () => void;
const textListeners = new Set<Listener>();
const scheduleListeners = new Set<Listener>();
const dismissListeners = new Set<Listener>();
const EMPTY_SCHEDULE: InfoBannerSchedule = { visibleFrom: null, visibleUntil: null };
let infoBanner = "";
let visibleFrom: string | null = null;
let visibleUntil: string | null = null;
let schedule: InfoBannerSchedule = EMPTY_SCHEDULE;
let dismissed = "";

function readText(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TEXT_KEY) ?? "";
}

function readStoredInstant(key: string): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function readDismissed(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(DISMISS_KEY) ?? "";
}

function writeInstant(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(key, value);
  else window.localStorage.removeItem(key);
}

function emitText() {
  for (const listener of textListeners) listener();
}

function emitSchedule() {
  for (const listener of scheduleListeners) listener();
}

function emitDismiss() {
  for (const listener of dismissListeners) listener();
}

function currentSchedule(): InfoBannerSchedule {
  return schedule;
}

function applySchedule(nextFrom: string | null, nextUntil: string | null) {
  if (nextFrom === visibleFrom && nextUntil === visibleUntil) return;
  visibleFrom = nextFrom;
  visibleUntil = nextUntil;
  schedule =
    nextFrom === null && nextUntil === null
      ? EMPTY_SCHEDULE
      : { visibleFrom: nextFrom, visibleUntil: nextUntil };
  writeInstant(FROM_KEY, nextFrom);
  writeInstant(UNTIL_KEY, nextUntil);
  emitSchedule();
}

export const infoBannerStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      const next = readText();
      if (next !== infoBanner) {
        infoBanner = next;
        emitText();
      }
    }
    textListeners.add(listener);
    return () => textListeners.delete(listener);
  },
  getSnapshot(): string {
    return infoBanner;
  },
  getServerSnapshot(): string {
    return "";
  },
  subscribeSchedule(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      applySchedule(readStoredInstant(FROM_KEY), readStoredInstant(UNTIL_KEY));
    }
    scheduleListeners.add(listener);
    return () => scheduleListeners.delete(listener);
  },
  getScheduleSnapshot(): InfoBannerSchedule {
    return currentSchedule();
  },
  getScheduleServerSnapshot(): InfoBannerSchedule {
    return EMPTY_SCHEDULE;
  },
  subscribeDismissed(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      const next = readDismissed();
      if (next !== dismissed) {
        dismissed = next;
        emitDismiss();
      }
    }
    dismissListeners.add(listener);
    return () => dismissListeners.delete(listener);
  },
  getDismissedSnapshot(): string {
    return dismissed;
  },
  getDismissedServerSnapshot(): string {
    return "";
  },
  isActive(nowMs: number = Date.now()): boolean {
    return isInfoBannerActiveNow(infoBanner, currentSchedule(), nowMs);
  },
  set(input: {
    text: string;
    visibleFrom?: string | null;
    visibleUntil?: string | null;
  }): Promise<void> {
    const previousText = infoBanner;
    const previousFrom = visibleFrom;
    const previousUntil = visibleUntil;
    const nextFrom = "visibleFrom" in input ? (input.visibleFrom ?? null) : visibleFrom;
    const nextUntil = "visibleUntil" in input ? (input.visibleUntil ?? null) : visibleUntil;

    infoBanner = input.text;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEXT_KEY, input.text);
    }
    emitText();
    applySchedule(nextFrom, nextUntil);

    return import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
      putDevSettings({
        infoBanner: input.text,
        infoBannerVisibleFrom: nextFrom,
        infoBannerVisibleUntil: nextUntil,
      })
        .then(() => undefined)
        .catch((error: unknown) => {
          infoBanner = previousText;
          if (typeof window !== "undefined") {
            window.localStorage.setItem(TEXT_KEY, previousText);
          }
          emitText();
          applySchedule(previousFrom, previousUntil);
          throw error;
        }),
    );
  },
  dismiss(): void {
    dismissed = infoBanner;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, infoBanner);
    }
    emitDismiss();
  },
  applyRemote(data: {
    text: string;
    visibleFrom?: string | null;
    visibleUntil?: string | null;
  }): void {
    if (data.text !== infoBanner) {
      infoBanner = data.text;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TEXT_KEY, data.text);
      }
      emitText();
    }
    if ("visibleFrom" in data || "visibleUntil" in data) {
      applySchedule(data.visibleFrom ?? null, data.visibleUntil ?? null);
    }
  },
};
