import { NextResponse } from "next/server";
import {
  addBacklogItem,
  listBacklogItems,
  removeBacklogItem,
  setBacklogItemDone,
} from "@/lib/backlog";
import { parseBacklogTitle } from "@/lib/backlog-shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ items: listBacklogItems() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  const title = parseBacklogTitle(
    typeof body === "object" && body !== null && "title" in body
      ? (body as { title: unknown }).title
      : null,
  );
  if (title == null) {
    return NextResponse.json(
      { error: "Bitte eine Idee mit 1–280 Zeichen eingeben." },
      { status: 400 },
    );
  }

  return NextResponse.json({ item: addBacklogItem(title) }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  const { id, done } = body as { id?: unknown; done?: unknown };
  if (typeof id !== "string" || typeof done !== "boolean") {
    return NextResponse.json({ error: "id und done sind erforderlich." }, { status: 400 });
  }

  const item = setBacklogItemDone(id, done);
  if (!item) {
    return NextResponse.json({ error: "Eintrag nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ item });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id ist erforderlich." }, { status: 400 });
  }

  if (!removeBacklogItem(id)) {
    return NextResponse.json({ error: "Eintrag nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
