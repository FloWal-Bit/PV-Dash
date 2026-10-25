/**
 * Standard-Tab auf Card 2 (Energiefluss-Karussell).
 * Tab 1 = Stromkonto, Tab 2 = Energiefluss.
 */

export type EnergyFlowDefaultTab = 1 | 2;

export const ENERGY_FLOW_DEFAULT_TAB_LABELS: Record<EnergyFlowDefaultTab, string> = {
  1: "Stromkonto",
  2: "Energiefluss",
};

const STORAGE_KEY = "pv-dash:energy-flow-default-tab";

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: EnergyFlowDefaultTab = 1;

function parseTab(raw: string | null): EnergyFlowDefaultTab {
  return raw === "2" ? 2 : 1;
}

function readStored(): EnergyFlowDefaultTab {
  if (typeof window === "undefined") return 1;
  try {
    return parseTab(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 1;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function energyFlowDefaultTabToPage(tab: EnergyFlowDefaultTab): number {
  return tab - 1;
}

export const energyFlowDefaultTabStore = {
  subscribe(listener: Listener): () => void {
    if (typeof window !== "undefined") {
      const next = readStored();
      if (next !== snapshot) {
        snapshot = next;
        emit();
      }
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): EnergyFlowDefaultTab {
    return snapshot;
  },
  getServerSnapshot(): EnergyFlowDefaultTab {
    return 1;
  },
  set(tab: EnergyFlowDefaultTab): void {
    snapshot = tab;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(tab));
    }
    emit();
  },
};
