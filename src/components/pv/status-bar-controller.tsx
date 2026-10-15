"use client";

import { useEffect } from "react";
import { readHideStatusBar } from "@/lib/status-bar";

/**
 * Stellt den Vollbildmodus nach einem Neuladen wieder her. Der Browser
 * erlaubt das nur nach einer Nutzeraktion, deshalb beim ersten Tipp.
 * Verlässt jemand den Vollbildmodus selbst, bleibt er für diese Sitzung aus.
 */
export function StatusBarController() {
  useEffect(() => {
    let sawFullscreen = false;
    let userLeft = false;

    const onChange = () => {
      if (document.fullscreenElement) sawFullscreen = true;
      else if (sawFullscreen) userLeft = true;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (userLeft || !readHideStatusBar() || document.fullscreenElement) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-status-bar-toggle]")) return;
      document.documentElement.requestFullscreen().catch(() => {});
    };

    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return null;
}
