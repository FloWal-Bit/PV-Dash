"use client";

import { useCallback, useRef, useState, type ReactNode, type TouchEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

const SWIPE_THRESHOLD_PX = 48;

function useSwipePageNavigation(
  page: number,
  pageCount: number,
  onPageChange?: (page: number) => void,
) {
  const touchStartX = useRef<number | null>(null);

  const goTo = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(pageCount - 1, index));
      onPageChange?.(next);
    },
    [onPageChange, pageCount],
  );

  const bindSwipeSurface = {
    className: "touch-pan-y",
    onTouchStart: (e: TouchEvent) => {
      touchStartX.current = e.changedTouches[0]?.clientX ?? 0;
    },
    onTouchEnd: (e: TouchEvent) => {
      if (touchStartX.current == null) return;
      const delta = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
      touchStartX.current = null;
      if (delta <= -SWIPE_THRESHOLD_PX) goTo(page + 1);
      else if (delta >= SWIPE_THRESHOLD_PX) goTo(page - 1);
    },
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === "mouse") touchStartX.current = e.clientX;
    },
    onPointerUp: (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || touchStartX.current == null) return;
      const delta = e.clientX - touchStartX.current;
      touchStartX.current = null;
      if (delta <= -SWIPE_THRESHOLD_PX) goTo(page + 1);
      else if (delta >= SWIPE_THRESHOLD_PX) goTo(page - 1);
    },
  };

  return { goTo, bindSwipeSurface };
}

export function SwipePageDots({
  labels,
  page,
  onPageChange,
  className,
}: {
  labels: string[];
  page: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)} role="tablist">
      {labels.map((label, index) => (
        <button
          key={label}
          type="button"
          role="tab"
          aria-selected={page === index}
          aria-label={label}
          onClick={() => onPageChange(index)}
          className={cn(
            "size-2 rounded-full transition-colors",
            page === index ? "bg-pager-dot" : "bg-muted-foreground/30",
          )}
        />
      ))}
    </div>
  );
}

/** Wischgeste + Punkte; Inhalt bleibt eine Ansicht (kein horizontaler Slide). */
export function SwipePageSurface({
  labels,
  page,
  onPageChange,
  children,
  className,
}: {
  labels: string[];
  page: number;
  onPageChange: (page: number) => void;
  children: ReactNode;
  className?: string;
}) {
  const { bindSwipeSurface } = useSwipePageNavigation(page, labels.length, onPageChange);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div {...bindSwipeSurface}>{children}</div>
      <SwipePageDots labels={labels} page={page} onPageChange={onPageChange} />
    </div>
  );
}

export function SwipeCarousel({
  labels,
  children,
  className,
  page: controlledPage,
  onPageChange,
  stretch = false,
  showDots = true,
}: {
  labels: string[];
  children: ReactNode[];
  className?: string;
  page?: number;
  onPageChange?: (page: number) => void;
  /** Fills a stretched parent from the md breakpoint up; dots stay below the slides. */
  stretch?: boolean;
  /** Punkte rendert der Aufrufer selbst, innerhalb der Karte. */
  showDots?: boolean;
}) {
  const pageCount = children.length;
  const [internalPage, setInternalPage] = useState(0);
  const page = controlledPage ?? internalPage;
  const touchStartX = useRef<number | null>(null);
  const dragging = useRef(false);

  const goTo = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(pageCount - 1, index));
      if (controlledPage == null) setInternalPage(next);
      onPageChange?.(next);
    },
    [controlledPage, onPageChange, pageCount],
  );

  const onTouchStart = (clientX: number) => {
    touchStartX.current = clientX;
    dragging.current = true;
  };

  const onTouchEnd = (clientX: number) => {
    if (touchStartX.current == null) return;
    const delta = clientX - touchStartX.current;
    touchStartX.current = null;
    dragging.current = false;
    if (delta <= -SWIPE_THRESHOLD_PX) goTo(page + 1);
    else if (delta >= SWIPE_THRESHOLD_PX) goTo(page - 1);
  };

  return (
    <div className={cn("flex flex-col gap-2", stretch && "md:h-full", className)}>
      <div
        className={cn("touch-pan-y overflow-hidden", stretch && "md:min-h-0 md:flex-1")}
        onTouchStart={(e) => onTouchStart(e.changedTouches[0]?.clientX ?? 0)}
        onTouchEnd={(e) => onTouchEnd(e.changedTouches[0]?.clientX ?? 0)}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") onTouchStart(e.clientX);
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "mouse") onTouchEnd(e.clientX);
        }}
      >
        <div
          className={cn(
            "flex transition-transform duration-300 ease-out",
            stretch && "md:h-full",
          )}
          style={{ transform: `translateX(-${page * 100}%)` }}
        >
          {children.map((child, index) => (
            <div
              key={labels[index] ?? index}
              className={cn("flex w-full shrink-0 flex-col", stretch && "md:h-full")}
            >
              {child}
            </div>
          ))}
        </div>
      </div>
      {showDots ? (
        <div className="swipe-carousel-dots flex items-center justify-center gap-2" role="tablist">
          {labels.map((label, index) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={page === index}
              aria-label={label}
              onClick={() => goTo(index)}
              className={cn(
                "size-2 rounded-full transition-colors",
                page === index ? "bg-pager-dot" : "bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
