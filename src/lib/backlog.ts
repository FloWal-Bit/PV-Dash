import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  SEED_BACKLOG_ITEMS,
  type BacklogItem,
} from "@/lib/backlog-shared";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "backlog.json");

function seedItems(): BacklogItem[] {
  const createdAt = new Date().toISOString();
  return SEED_BACKLOG_ITEMS.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    createdAt,
  }));
}

function isBacklogItem(value: unknown): value is BacklogItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.done === "boolean" &&
    typeof v.createdAt === "string"
  );
}

function persist(items: BacklogItem[]): BacklogItem[] {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify({ items }, null, 2), "utf8");
  return items;
}

export function listBacklogItems(): BacklogItem[] {
  try {
    if (!existsSync(DATA_FILE)) {
      return persist(seedItems());
    }

    const parsed: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("items" in parsed)) {
      return persist(seedItems());
    }

    const rawItems = (parsed as { items: unknown }).items;
    if (!Array.isArray(rawItems)) return persist(seedItems());

    const items = rawItems.filter(isBacklogItem);
    return items.length ? items : persist(seedItems());
  } catch {
    return persist(seedItems());
  }
}

export function addBacklogItem(title: string): BacklogItem {
  const items = listBacklogItems();
  const item: BacklogItem = {
    id: crypto.randomUUID(),
    title,
    done: false,
    createdAt: new Date().toISOString(),
  };
  persist([item, ...items]);
  return item;
}

export function setBacklogItemDone(id: string, done: boolean): BacklogItem | null {
  const items = listBacklogItems();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  items[index] = { ...items[index], done };
  persist(items);
  return items[index];
}

export function removeBacklogItem(id: string): boolean {
  const items = listBacklogItems();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  persist(next);
  return true;
}
