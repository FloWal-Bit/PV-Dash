"use client";

import { useEffect } from "react";
import {
  mustNotAutoRequestFullscreen,
  mustNotRequestDocumentFullscreen,
  readHideStatusBar,
  requestHideStatusBarFullscreen,
} from "@/lib/status-bar";

/**
 * Hält Vollbild, wenn «Statusleiste ausblenden» aktiv ist.
 * Nach Sleep/App-Wechsel beendet Android oft den Fullscreen — dann erneut
 * anfordern: zuerst beim Sichtbarwerden, sonst beim nächsten Tipp (Geste).
 * iOS bleibt ausgenommen. Desktop ohne Geste erst nach pointerdown.
 */
export function StatusBarController() {
  useEffect(() => {
    /** true nur wenn der Nutzer Vollbild bewusst verlassen hat (sichtbare Seite). */
    let userLeft = false;

    const enter = (opts?: { userGesture?: boolean }) => {
      if (userLeft || !readHideStatusBar() || document.fullscreenElement) return;
      if (mustNotRequestDocumentFullscreen()) return;
      if (!opts?.userGesture && mustNotAutoRequestFullscreen()) return;
      void requestHideStatusBarFullscreen();
    };

    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        userLeft = false;
        return;
      }
      // Beim Schlafen/Hintergrund beendet das OS Fullscreen — nicht als
      // «Nutzer will Leiste» werten, sonst bleibt sie nach dem Aufwachen.
      if (!document.hidden) {
        userLeft = true;
      }
    };

    const onVisibility = () => {
      if (document.hidden) return;
      if (!readHideStatusBar()) return;
      userLeft = false;
      enter();
    };

    const onPageShow = () => {
      if (!readHideStatusBar()) return;
      userLeft = false;
      enter();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-status-bar-toggle]")) return;
      if (!readHideStatusBar()) return;
      userLeft = false;
      enter({ userGesture: true });
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pointerdown", onPointerDown);
    enter();

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return null;
}
