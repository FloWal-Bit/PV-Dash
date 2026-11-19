"use client";

/**
 * Rundet beim Wegscrollen unter dem Sticky-Block die oberen Ecken jeder Card
 * passend zu rounded-2xl (inkl. 1px-Ring) ab. Bleibt über position:sticky im
 * Compositor synchron mit dem Scroll und ragt nie in die nächste Card hinein.
 */
export function ScrollRoundedCorners() {
  return (
    <div
      aria-hidden
      className="pointer-events-none sticky top-[var(--dashboard-sticky-height,0px)] z-20 mb-[calc(var(--radius-2xl)*-1)] h-[var(--radius-2xl)] w-full shrink-0"
    >
      <CornerMask side="left" />
      <CornerMask side="right" />
    </div>
  );
}

function CornerMask({ side }: { side: "left" | "right" }) {
  const isRight = side === "right";
  return (
    <div
      className={`absolute -top-px size-[calc(var(--radius-2xl)+1px)] ${
        isRight ? "-right-px" : "-left-px"
      }`}
    >
      {/* 2px-Überhang nach oben (hinter Sticky-Block) & seitlich (Gutter) gegen Subpixel-Blitzer. */}
      <div
        className={`absolute -top-[2px] h-[2px] bg-background ${
          isRight ? "-right-[2px] left-0" : "-left-[2px] right-0"
        }`}
      />
      <div
        className={`absolute -top-[2px] bottom-0 w-[2px] bg-background ${
          isRight ? "-right-[2px]" : "-left-[2px]"
        }`}
      />
      <svg
        viewBox="0 0 100 100"
        className={`block size-full fill-background ${isRight ? "-scale-x-100" : ""}`}
      >
        <path d="M0 0H100A100 100 0 0 0 0 100Z" />
      </svg>
    </div>
  );
}
