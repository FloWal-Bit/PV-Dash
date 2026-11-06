/**
 * Client-Spiegel der Server-Pause-Zeiten (localStorage), damit die Offline-App
 * die geplante Pause kennt, ohne den Server zu erreichen.
 */

import {
  DEFAULT_SERVER_PAUSE,
  type ServerPauseSettings,
} from "@/lib/server-pause";

const KEY = "pv-dash:server-pause";

type Listener = () => void;
const listeners = new Set<Listener>();
let settings: ServerPauseSettings = { ...DEFAULT_SERVER_PAUSE };

function readStored(): ServerPauseSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SERVER_PAUSE };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SERVER_PAUSE };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SERVER_PAUSE };
    const v = parsed as Partial<ServerPauseSettings>;
    return {
      enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_SERVER_PAUSE.enabled,
      stopAt: typeof v.stopAt === "string" ? v.stopAt : DEFAULT_SERVER_PAUSE.stopAt,
      resumeAt: typeof v.resumeAt === "string" ? v.resumeAt : DEFAULT_SERVER_PAUSE.resumeAt,
    };
  } catch {
    return { ...DEFAULT_SERVER_PAUSE };
  }
}

function writeStored(next: ServerPauseSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

function emit() {
  for (const listener of listeners) listener();
}

export const serverPauseSettingsStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      const next = readStored();
      if (
        next.enabled !== settings.enabled ||
        next.stopAt !== settings.stopAt ||
        next.resumeAt !== settings.resumeAt
      ) {
        settings = next;
        emit();
      }
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ServerPauseSettings {
    return settings;
  },
  getServerSnapshot(): ServerPauseSettings {
    return { ...DEFAULT_SERVER_PAUSE };
  },
  applyRemote(next: ServerPauseSettings): void {
    if (
      next.enabled === settings.enabled &&
      next.stopAt === settings.stopAt &&
      next.resumeAt === settings.resumeAt
    ) {
      return;
    }
    settings = next;
    writeStored(next);
    emit();
  },
  set(next: ServerPauseSettings): Promise<void> {
    const previous = settings;
    settings = next;
    writeStored(next);
    emit();
    return import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
      putDevSettings({
        serverPauseEnabled: next.enabled,
        serverPauseStopAt: next.stopAt,
        serverPauseResumeAt: next.resumeAt,
      })
        .then(() => undefined)
        .catch((error: unknown) => {
          settings = previous;
          writeStored(previous);
          emit();
          throw error;
        }),
    );
  },
};
