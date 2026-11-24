import { NextResponse } from "next/server";
import {
  CONTROL_COOKIE_MAX_AGE,
  CONTROL_DEVICE_COOKIE,
  bindControlDevice,
  controlPasswordBlocked,
  controlPasswordConfigured,
  controlPasswordMatches,
  cookieSecure,
  createControlDeviceToken,
  noteControlPasswordFailure,
  noteControlPasswordSuccess,
  requestHasControlDevice,
} from "@/lib/control-device";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    configured: controlPasswordConfigured(),
    unlocked: requestHasControlDevice(request),
  });
}

export async function POST(request: Request) {
  if (!controlPasswordConfigured()) {
    return NextResponse.json(
      { error: "Auf dem Server ist kein Gerätepasswort gesetzt." },
      { status: 503 },
    );
  }
  const block = controlPasswordBlocked();
  if (block.blocked) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte später erneut." },
      { status: 429, headers: { "Retry-After": String(block.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  const password =
    typeof body === "object" && body != null && "password" in body
      ? (body as { password: unknown }).password
      : undefined;
  if (typeof password !== "string" || !password.trim()) {
    return NextResponse.json({ error: "Passwort fehlt." }, { status: 400 });
  }
  if (!controlPasswordMatches(password)) {
    noteControlPasswordFailure();
    return NextResponse.json({ error: "Passwort ist falsch." }, { status: 401 });
  }

  noteControlPasswordSuccess();
  const token = createControlDeviceToken();
  bindControlDevice(token);
  const response = NextResponse.json({ configured: true, unlocked: true });
  response.cookies.set(CONTROL_DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CONTROL_COOKIE_MAX_AGE,
    secure: cookieSecure(request),
  });
  return response;
}
