/* PV Dash offline shell — network-first, Cache-Fallback wenn Infomaniak pausiert. */
const CACHE_NAME = "pv-dash-shell-v1.5.7.28";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", "/icon.svg"]).catch(() => undefined)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

/** Cached Shell für Navigation / Assets, wenn Netz fehlt oder der Proxy 5xx liefert. */
async function cachedFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  if (request.mode === "navigate") {
    const shell = await caches.match("/");
    if (shell) return shell;
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // /api/* bewusst nicht cachen — Offline-Daten kommen aus localStorage (pv-store).
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        }
        // Infomaniak/Proxy liefert bei pausiertem Node oft 502/503 — nicht die Fehlerseite zeigen.
        if (response.status >= 500) {
          const fallback = await cachedFallback(request);
          if (fallback) return fallback;
        }
        return response;
      })
      .catch(async () => {
        const fallback = await cachedFallback(request);
        if (fallback) return fallback;
        return Response.error();
      }),
  );
});
