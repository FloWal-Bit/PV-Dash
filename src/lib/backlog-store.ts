import type { BacklogItem } from "@/lib/backlog-shared";

export type BacklogStoreState = {
  items: BacklogItem[];
  loading: boolean;
  error: string | null;
};

const INITIAL_STATE: BacklogStoreState = {
  items: [],
  loading: true,
  error: null,
};

type Listener = () => void;

class BacklogStore {
  private listeners = new Set<Listener>();
  private state: BacklogStoreState = INITIAL_STATE;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      void this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;
  getServerSnapshot = () => INITIAL_STATE;

  private setState(next: BacklogStoreState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  refresh = async () => {
    try {
      const response = await fetch("/api/backlog", { cache: "no-store" });
      if (!response.ok) throw new Error("Backlog konnte nicht geladen werden.");
      const data: { items: BacklogItem[] } = await response.json();
      this.setState({ items: data.items, loading: false, error: null });
    } catch {
      this.setState({
        items: this.state.items,
        loading: false,
        error: "Backlog konnte nicht geladen werden.",
      });
    }
  };

  add = async (title: string) => {
    const response = await fetch("/api/backlog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data: { item?: BacklogItem; error?: string } = await response.json();
    if (!response.ok || !data.item) {
      throw new Error(data.error ?? "Idee konnte nicht gespeichert werden.");
    }
    this.setState({
      items: [data.item, ...this.state.items.filter((item) => item.id !== data.item?.id)],
      loading: false,
      error: null,
    });
  };

  toggle = async (id: string, done: boolean) => {
    const previous = this.state.items;
    this.setState({
      ...this.state,
      items: previous.map((item) => (item.id === id ? { ...item, done } : item)),
    });

    const response = await fetch("/api/backlog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done }),
    });
    if (!response.ok) {
      this.setState({ ...this.state, items: previous, error: "Status konnte nicht gespeichert werden." });
    }
  };

  remove = async (id: string) => {
    const previous = this.state.items;
    this.setState({
      ...this.state,
      items: previous.filter((item) => item.id !== id),
    });

    const response = await fetch(`/api/backlog?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      this.setState({ ...this.state, items: previous, error: "Eintrag konnte nicht gelöscht werden." });
    }
  };
}

export const backlogStore = new BacklogStore();
