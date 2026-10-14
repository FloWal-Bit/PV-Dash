"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InfoPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (!open || !panel || !button) return;

    const place = () => {
      const rect = button.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const margin = 8;
      let left = rect.right - panelRect.width;
      left = Math.max(margin, Math.min(left, window.innerWidth - margin - panelRect.width));
      let top = rect.bottom + 6;
      if (top + panelRect.height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - 6 - panelRect.height);
      }
      panel.style.inset = "auto";
      panel.style.margin = "0";
      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
    };

    if (!panel.matches(":popover-open")) panel.showPopover();
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        className="text-muted-foreground"
        onClick={() => setOpen((current) => !current)}
      >
        <Info />
      </Button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="note"
          popover="manual"
          className="fixed z-50 m-0 w-72 rounded-xl border-0 bg-popover p-3 text-xs leading-snug text-popover-foreground shadow-card ring-1 ring-foreground/10"
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
