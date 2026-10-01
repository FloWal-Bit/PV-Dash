export type BacklogItem = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
};

export const MAX_BACKLOG_TITLE_LENGTH = 280;

export const SEED_BACKLOG_ITEMS: Omit<BacklogItem, "id" | "createdAt">[] = [
  { title: "Modbus TCP im Dongle aktivieren", done: false },
];

export function parseBacklogTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title || title.length > MAX_BACKLOG_TITLE_LENGTH) return null;
  return title;
}
