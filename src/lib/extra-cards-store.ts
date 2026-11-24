"use client";

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
