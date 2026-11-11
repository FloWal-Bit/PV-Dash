"use client";

import { useEffect } from "react";
import {
  consumeIntentionalFullscreenExit,
  mustNotAutoRequestFullscreen,
  mustNotRequestDocumentFullscreen,
  readHideStatusBar,
  requestHideStatusBarFullscreen,
} from "@/lib/status-bar";

const RESUME_RETRY_MS = [0, 250, 800, 2000] as const;

/**
 * Hält Vollbild, wenn «Statusleiste ausblenden» aktiv ist.
 *
 * Android/PWA beenden Document-Fullscreen oft beim Schlafen oder App-Wechsel.
 * Beim Sichtbarwerden wird deshalb erneut angefordert (auch ohne Geste —
 * sonst bleibt die Leiste; ein Chrome-Toast kann einmal erscheinen).
 * Zusätzlich: Tipp als Fallback. iOS bleibt ausgenommen.
 * Erstes Öffnen ohne Geste auf Android/PWA weiter ohne Auto-Fullscreen (Toast).
 */
export function StatusBarController() {
  useEffect(() => {
    /** true nur nach bewusstem Toggle «Leiste anzeigen» bzw. Preference aus. */
    let userLeft = false;
    let resumeTimers: ReturnType<typeof setTimeout>[] = [];

    const clearResumeTimers = () => {
      for (const id of resumeTimers) clearTimeout(id);
      resumeTimers = [];
    };

    const enter = (opts?: { userGesture?: boolean; resume?: boolean }) => {
      if (userLeft || !readHideStatusBar() || document.fullscreenElement) return;
      if (mustNotRequestDocumentFullscreen()) return;
      // Erstes Öffnen: kein Auto-Fullscreen auf Android/PWA. Nach Wake/Tipp schon.
      if (!opts?.userGesture && !opts?.resume && mustNotAutoRequestFullscreen()) return;
      void requestHideStatusBarFullscreen();
    };

    const scheduleResumeEnter = () => {
      if (userLeft || !readHideStatusBar()) return;
      clearResumeTimers();
      for (const delay of RESUME_RETRY_MS) {
        resumeTimers.push(
          setTimeout(() => {
            if (userLeft || !readHideStatusBar() || document.fullscreenElement) return;
            enter({ resume: true });
          }, delay),
        );
      }
    };

    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        userLeft = false;
        clearResumeTimers();
        return;
      }

      if (consumeIntentionalFullscreenExit() || !readHideStatusBar()) {
        userLeft = true;
        clearResumeTimers();
        return;
      }

      // OS hat Fullscreen beendet (Sleep, Gesture, App-Wechsel) — Preference bleibt an.
      userLeft = false;
      if (!document.hidden) {
        scheduleResumeEnter();
      }
    };

    const onVisibility = () => {
      if (document.hidden) return;
      if (!readHideStatusBar()) return;
      userLeft = false;
      scheduleResumeEnter();
    };

    const onPageShow = () => {
      if (!readHideStatusBar()) return;
      userLeft = false;
      scheduleResumeEnter();
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
    // capture: true — greift auch, wenn Kinder stopPropagation nutzen.
    window.addEventListener("pointerdown", onPointerDown, true);
    enter();

    return () => {
      clearResumeTimers();
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  return null;
}
