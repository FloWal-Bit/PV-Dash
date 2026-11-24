"use client";

import {
  normalizePushDeviceIds,
  readPushDeviceIds,
  samePushDeviceIds,
} from "@/lib/dev-settings-shared";
import {
  DEFAULT_EXTRA_CARDS,
  type ExtraCardsSettings,
} from "@/lib/extra-cards-shared";

type Listener = () => void;
const listeners = new Set<Listener>();
let state: ExtraCardsSettings = DEFAULT_EXTRA_CARDS;

function emit() {
  for (const listener of listeners) listener();
}

export const extraCardsStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ExtraCardsSettings {
    return state;
  },
  getServerSnapshot(): ExtraCardsSettings {
    return DEFAULT_EXTRA_CARDS;
  },
  applyRemote(next: ExtraCardsSettings): void {
    state = next;
    emit();
  },
};

const deviceListeners = new Set<Listener>();
let deviceIds: string[] = [];

function emitDevices() {
  for (const listener of deviceListeners) listener();
}

/** Geräte, die Lampe und Sonos sehen. Standard leer, wie bei Push. */
export const cardDeviceStore = {
  subscribe(listener: Listener): () => void {
    deviceListeners.add(listener);
    return () => deviceListeners.delete(listener);
  },
  getSnapshot(): string[] {
    return deviceIds;
  },
  getServerSnapshot(): string[] {
    return [];
  },
  applyRemote(ids: string[]): void {
    const next = readPushDeviceIds(ids);
    if (samePushDeviceIds(deviceIds, next)) return;
    deviceIds = next;
    emitDevices();
  },
  setEnabled(id: string, enabled: boolean): Promise<void> {
    const needle = id.toLowerCase();
    const previous = deviceIds;
    const nextIds = enabled
      ? normalizePushDeviceIds(previous.includes(needle) ? previous : [...previous, needle])
      : previous.filter((item) => item !== needle);
    if (samePushDeviceIds(previous, nextIds)) return Promise.resolve();
    deviceIds = nextIds;
    emitDevices();
    return import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
      putDevSettings({ cardDeviceIds: nextIds })
        .then(() => undefined)
        .catch((error: unknown) => {
          if (samePushDeviceIds(deviceIds, nextIds)) {
            deviceIds = previous;
            emitDevices();
          }
          throw error;
        }),
    );
  },
};
