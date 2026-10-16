import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const readme = await readFile(path.join(process.cwd(), "README.md"), "utf8");
  return new NextResponse(readme, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
