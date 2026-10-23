/**
 * Hinweistext für das Banner oberhalb der Wetterkarte.
 * Der Text liegt in den Dev-Einstellungen und gilt für alle Geräte.
 * Das Schliessen gilt nur auf diesem Gerät, bis der Text sich ändert.
 */

const TEXT_KEY = "pv-dash:info-banner";
const DISMISS_KEY = "pv-dash:info-banner-dismissed";

type Listener = () => void;
const textListeners = new Set<Listener>();
const dismissListeners = new Set<Listener>();
let infoBanner = "";
let dismissed = "";

function readText(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TEXT_KEY) ?? "";
}

function readDismissed(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(DISMISS_KEY) ?? "";
}

function emitText() {
  for (const listener of textListeners) listener();
}

function emitDismiss() {
  for (const listener of dismissListeners) listener();
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
  set(text: string): Promise<void> {
    const previous = infoBanner;
    infoBanner = text;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEXT_KEY, text);
    }
    emitText();
    return import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
      putDevSettings({ infoBanner: text })
        .then(() => undefined)
        .catch((error: unknown) => {
          infoBanner = previous;
          if (typeof window !== "undefined") {
            window.localStorage.setItem(TEXT_KEY, previous);
          }
          emitText();
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
  applyRemote(text: string): void {
    if (text === infoBanner) return;
    infoBanner = text;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEXT_KEY, text);
    }
    emitText();
  },
};
