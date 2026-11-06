"use client";

import { useEffect } from "react";
import { APP_VERSION } from "@/lib/version";

/** Registriert den Offline-Shell-Service-Worker (Infomaniak-Pause). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const src = `/sw.js?v=${encodeURIComponent(APP_VERSION)}`;
    void navigator.serviceWorker.register(src).catch(() => {
      /* private mode / unsupported */
    });
  }, []);
  return null;
}
