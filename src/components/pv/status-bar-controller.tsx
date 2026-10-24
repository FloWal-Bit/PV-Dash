"use client";

import { useEffect } from "react";
import { mustNotRequestDocumentFullscreen, readHideStatusBar } from "@/lib/status-bar";

/**
 * Startet im Vollbild, wo das ohne den Systemtoast möglich ist.
 * Installierte Apps sind bereits ohne Browserleiste. Android und iOS/iPadOS
 * rufen die Fullscreen-API nicht auf. Ein normaler Tab darf den Vollbildmodus erst nach
 * einem Tipp betreten, deshalb beim ersten Zeigerkontakt. Wer ihn selbst
 * verlässt, bleibt für diese Sitzung im Fenster.
 */
export function StatusBarController() {
  useEffect(() => {
    let sawFullscreen = false;
    let userLeft = false;

    const enter = () => {
      if (userLeft || !readHideStatusBar() || document.fullscreenElement) return;
      if (mustNotRequestDocumentFullscreen()) return;
      if (typeof document.documentElement.requestFullscreen !== "function") return;
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    };

    const onChange = () => {
      if (document.fullscreenElement) sawFullscreen = true;
      else if (sawFullscreen) userLeft = true;
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-status-bar-toggle]")) return;
      enter();
    };

    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("pointerdown", onPointerDown);
    enter();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return null;
}
