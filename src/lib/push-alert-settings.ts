"use client";

/**
 * Welche Geräte Push erhalten, und wann bei Stromüberschuss gemeldet wird.
 * Liegt in den Dev-Einstellungen und gilt für alle Geräte.
 */

import { readDeviceId } from "@/lib/device-visit";
import {
  copySurplusAlert,
  normalizePushDeviceIds,
  readPushDeviceIds,
  readSurplusAlert,
  samePushDeviceIds,
  sameSurplusAlert,
  type SurplusAlertSettings,
} from "@/lib/dev-settings-shared";

const DEVICES_KEY = "pv-dash:push-device-ids";
const SURPLUS_KEY = "pv-dash:surplus-alert";

export type PushAlertState = {
  deviceIds: string[];
  surplus: SurplusAlertSettings;
};

type Listener = () => void;
const listeners = new Set<Listener>();

function defaultState(): PushAlertState {
  return { deviceIds: [], surplus: copySurplusAlert() };
}

const SERVER_STATE: PushAlertState = defaultState();
let state: PushAlertState = SERVER_STATE;

function readStored(): PushAlertState {
  if (typeof window === "undefined") return defaultState();
  let deviceIds: string[] = [];
  let surplus = copySurplusAlert();
  try {
    const rawIds = window.localStorage.getItem(DEVICES_KEY);
    if (rawIds) deviceIds = readPushDeviceIds(JSON.parse(rawIds) as unknown);
  } catch {
    deviceIds = [];
  }
  try {
    const rawSurplus = window.localStorage.getItem(SURPLUS_KEY);
    if (rawSurplus) surplus = readSurplusAlert(JSON.parse(rawSurplus) as unknown);
  } catch {
    surplus = copySurplusAlert();
  }
  return { deviceIds, surplus };
}

function writeStored(next: PushAlertState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEVICES_KEY, JSON.stringify(next.deviceIds));
  window.localStorage.setItem(SURPLUS_KEY, JSON.stringify(next.surplus));
}

function emit() {
  for (const listener of listeners) listener();
}

function commit(next: PushAlertState) {
  state = next;
  writeStored(next);
  emit();
}

function statesMatch(a: PushAlertState, b: PushAlertState): boolean {
  return samePushDeviceIds(a.deviceIds, b.deviceIds) && sameSurplusAlert(a.surplus, b.surplus);
}

/** Liest den lokalen Stand. Aus useEffect und den Benachrichtigungs-Checks, nicht während des Renderns. */
export function currentPushAlertState(): PushAlertState {
  if (typeof window === "undefined") return state;
  const stored = readStored();
  if (!statesMatch(stored, state)) {
    state = stored;
    emit();
  }
  return state;
}

export function thisDeviceReceivesPush(): boolean {
  const id = readDeviceId();
  if (!id) return false;
  const needle = id.toLowerCase();
  return currentPushAlertState().deviceIds.some((item) => item === needle);
}

let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export const pushAlertStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      const stored = readStored();
      if (!statesMatch(stored, state)) {
        state = stored;
        emit();
      }
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): PushAlertState {
    return state;
  },
  getServerSnapshot(): PushAlertState {
    return SERVER_STATE;
  },
  setDeviceEnabled(id: string, enabled: boolean): Promise<void> {
    const needle = id.toLowerCase();
    const previous = state.deviceIds;
    const nextIds = enabled
      ? normalizePushDeviceIds(previous.includes(needle) ? previous : [...previous, needle])
      : previous.filter((item) => item !== needle);
    if (samePushDeviceIds(previous, nextIds)) return Promise.resolve();
    commit({ ...state, deviceIds: nextIds });
    return enqueue(() =>
      import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
        putDevSettings({ pushDeviceIds: nextIds })
          .then(() => undefined)
          .catch((error: unknown) => {
            if (samePushDeviceIds(state.deviceIds, nextIds)) {
              commit({ ...state, deviceIds: previous });
            }
            throw error;
          }),
      ),
    );
  },
  setSurplus(next: SurplusAlertSettings): Promise<void> {
    const previous = state.surplus;
    const normalized = copySurplusAlert(next);
    if (sameSurplusAlert(previous, normalized)) return Promise.resolve();
    commit({ ...state, surplus: normalized });
    return enqueue(() =>
      import("@/lib/dev-settings-sync").then(({ putDevSettings }) =>
        putDevSettings({ surplusAlert: normalized })
          .then(() => undefined)
          .catch((error: unknown) => {
            if (sameSurplusAlert(state.surplus, normalized)) {
              commit({ ...state, surplus: previous });
            }
            throw error;
          }),
      ),
    );
  },
  applyRemote(next: { deviceIds: string[]; surplus: SurplusAlertSettings }): void {
    const deviceIds = readPushDeviceIds(next.deviceIds);
    const surplus = readSurplusAlert(next.surplus);
    if (samePushDeviceIds(state.deviceIds, deviceIds) && sameSurplusAlert(state.surplus, surplus)) {
      return;
    }
    commit({ deviceIds, surplus });
  },
};
