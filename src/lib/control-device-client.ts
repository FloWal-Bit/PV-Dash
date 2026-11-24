"use client";

export type ControlDeviceState = {
  configured: boolean;
  unlocked: boolean;
};

const CLOSED: ControlDeviceState = { configured: false, unlocked: false };

type Listener = () => void;
const listeners = new Set<Listener>();
let state: ControlDeviceState = CLOSED;

function emit() {
  for (const listener of listeners) listener();
}

function apply(next: ControlDeviceState) {
  state = next;
  emit();
}

export const controlDeviceStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ControlDeviceState {
    return state;
  },
  getServerSnapshot(): ControlDeviceState {
    return CLOSED;
  },
};

export async function pullControlDevice(): Promise<void> {
  const response = await fetch("/api/device-access", { cache: "no-store" });
  if (!response.ok) return;
  const data = (await response.json()) as { configured?: boolean; unlocked?: boolean };
  apply({
    configured: data.configured === true,
    unlocked: data.unlocked === true,
  });
}

export async function unlockControlDevice(password: string): Promise<void> {
  const response = await fetch("/api/device-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = (await response.json()) as { error?: string; configured?: boolean; unlocked?: boolean };
  if (!response.ok) {
    throw new Error(data.error ?? "Freigabe fehlgeschlagen.");
  }
  apply({ configured: true, unlocked: data.unlocked === true });
}
