"use client";

import { useEffect } from "react";
import {
  consumeIntentionalFullscreenExit,
  mustNotRequestDocumentFullscreen,
  needsImmersiveDocumentFullscreen,
  readHideStatusBar,
  requestHideStatusBarFullscreen,
} from "@/lib/status-bar";

const ENSURE_RETRY_MS = [0, 250, 800, 2000, 5000] as const;

/**
 * Hält immersive Vollbild-Ansicht (Status- + Navigationsleiste aus), solange
 * «Systemleisten ausblenden» aktiv ist.
 *
 * Document-Fullscreen mit navigationUI:"hide". Nach Sleep/App-Wechsel und
 * wenn die Leisten wieder sichtbar wirken, erneut anfordern. Tipp als Fallback
 * (Browser verlangen oft eine Geste). iOS: API nicht verfügbar.
 */
export function StatusBarController() {
  useEffect(() => {
    /** true nur nach bewusstem Toggle «Leisten anzeigen». */
    let userLeft = false;
    let ensureTimers: ReturnType<typeof setTimeout>[] = [];

    const clearEnsureTimers = () => {
      for (const id of ensureTimers) clearTimeout(id);
      ensureTimers = [];
    };

    const enter = () => {
      if (userLeft || !readHideStatusBar()) return;
      if (mustNotRequestDocumentFullscreen()) return;
      if (!needsImmersiveDocumentFullscreen()) return;
      void requestHideStatusBarFullscreen();
    };

    const scheduleEnsure = () => {
      if (userLeft || !readHideStatusBar()) return;
      clearEnsureTimers();
      for (const delay of ENSURE_RETRY_MS) {
        ensureTimers.push(
          setTimeout(() => {
            if (userLeft || !readHideStatusBar()) return;
            enter();
          }, delay),
        );
      }
    };

    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        userLeft = false;
        clearEnsureTimers();
        return;
      }

      if (consumeIntentionalFullscreenExit() || !readHideStatusBar()) {
        userLeft = true;
        clearEnsureTimers();
        return;
      }

      userLeft = false;
      if (!document.hidden) {
        scheduleEnsure();
      }
    };

    const onVisibility = () => {
      if (document.hidden) return;
      if (!readHideStatusBar()) return;
      userLeft = false;
      scheduleEnsure();
    };

    const onPageShow = () => {
      if (!readHideStatusBar()) return;
      userLeft = false;
      scheduleEnsure();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-status-bar-toggle]")) return;
      if (!readHideStatusBar()) return;
      userLeft = false;
      enter();
    };

    const onResize = () => {
      if (userLeft || !readHideStatusBar() || document.hidden) return;
      if (needsImmersiveDocumentFullscreen()) {
        scheduleEnsure();
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    scheduleEnsure();

    return () => {
      clearEnsureTimers();
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return null;
}
