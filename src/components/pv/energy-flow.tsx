"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  BatteryFull,
  Home,
  Sun,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SIMULATED_OPACITY_CLASS, isGridSimulated, isPvSimulated } from "@/lib/data-fidelity";
import { hideSimulatedStore } from "@/lib/hide-simulated";
import { formatKw } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PvSnapshot } from "@/lib/pv-data";
import type { DataSource, GridSource } from "@/lib/pv-source";

type EnergyFlowProps = {
  snapshot: PvSnapshot;
  source: DataSource;
  gridSource: GridSource;
  className?: string;
};

type Accent = "green" | "rose" | "amber";

const ACCENT_VAR: Record<Accent, string> = {
  green: "var(--chart-3)",
  rose: "var(--chart-5)",
  amber: "var(--chart-1)",
};

const ACCENT_RING: Record<Accent, string> = {
  green: "border-chart-3 text-chart-3",
  rose: "border-chart-5 text-chart-5",
  amber: "border-chart-1 text-chart-1",
};

const ACCENT_BG: Record<Accent, string> = {
  green: "from-chart-3/20 to-chart-3/5",
  rose: "from-chart-5/20 to-chart-5/5",
  amber: "from-chart-1/20 to-chart-1/5",
};

/**
 * Ein Knoten im Energiefluss-Diagramm: kreisförmiges Icon mit Wert, plus
 * Beschriftung darüber oder darunter. Angelehnt an die Fluss-Darstellung
 * gängiger PV-Monitoring-Apps (z. B. Huawei FusionSolar).
 *
 * `circleRef` zeigt exakt auf den Kreis (nicht auf Label + Kreis), damit die
 * Verbindungslinien im Diagramm ihre tatsächliche Position vermessen können,
 * statt sie anhand der Beschriftungshöhe zu erraten.
 */
function FlowNode({
  circleRef,
  icon,
  value,
  label,
  accent,
  muted,
  simulated,
  labelPosition,
  labelClassName,
  labelRef,
  className,
  style,
}: {
  circleRef: (el: HTMLDivElement | null) => void;
  icon: ReactNode;
  value: string;
  label: string;
  accent: Accent;
  muted?: boolean;
  simulated?: boolean;
  labelPosition: "top" | "bottom";
  labelClassName?: string;
  labelRef?: (el: HTMLSpanElement | null) => void;
  className?: string;
  style: CSSProperties;
}) {
  const labelNode = (
    <span
      ref={labelRef}
      className={cn(
        "text-[11px] font-medium text-muted-foreground",
        labelClassName,
      )}
    >
      {label}
    </span>
  );

  return (
    <div
      className={cn(
        "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 transition-opacity",
        className,
        simulated && SIMULATED_OPACITY_CLASS,
      )}
      style={style}
    >
      {labelPosition === "top" ? labelNode : null}
      <div
        ref={circleRef}
        className={cn(
          "flex size-16 flex-col items-center justify-center gap-0.5 rounded-full border-[3px] bg-gradient-to-br shadow-inner sm:size-[4.75rem]",
          muted
            ? "border-border text-muted-foreground/60"
            : cn(ACCENT_RING[accent], ACCENT_BG[accent]),
        )}
      >
        {icon}
        <span className="text-xs font-semibold tabular-nums leading-none sm:text-sm">
          {value}
        </span>
      </div>
      {labelPosition === "bottom" ? labelNode : null}
    </div>
  );
}

/**
 * Verbindungslinie mit animierten Strichsegmenten entlang des Pfads.
 * `reverse` kehrt die Laufrichtung um (z. B. Netzbezug: Stromkonto → Verteiler).
 */
function FlowPath({
  d,
  accent,
  active,
  reverse = false,
}: {
  d: string;
  accent: Accent;
  active: boolean;
  reverse?: boolean;
}) {
  const color = ACCENT_VAR[accent];

  return (
    <>
      <path
        d={d}
        fill="none"
        stroke="var(--border)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.45}
      />
      <path
        d={d}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-500"
        style={{
          stroke: active ? color : "var(--border)",
          opacity: active ? 0.28 : 0.55,
        }}
      />
      {active ? (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="7 13"
          className={cn("energy-flow-dash", reverse && "energy-flow-dash-reverse")}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      ) : null}
    </>
  );
}

type Circle = { cx: number; cy: number; r: number };
type Geometry = {
  width: number;
  height: number;
  pv: Circle;
  verbrauch: Circle;
  stromkonto: Circle;
};

const CORNER_RADIUS = 18;
/** Horizontaler Abstand der beiden parallelen PV-Leitungen zur Mitte. */
const PV_LINE_OFFSET = 6;
/** Vertikaler Abstand der zwei Horizontalen am Verbrauch/Stromkonto (oberhalb/unterhalb der Kreismitte). */
const SIDE_BRANCH_SPREAD = 11;

/** Abgang am unteren PV-Rand – zwei parallele Startpunkte auf dem Kreisbogen. */
function pvLineStart(pv: Circle, side: "left" | "right"): { x: number; y: number } {
  const offset = side === "left" ? -PV_LINE_OFFSET : PV_LINE_OFFSET;
  const x = pv.cx + offset;
  const dx2 = offset * offset;
  if (dx2 >= pv.r * pv.r) return { x, y: pv.cy + pv.r };
  return { x, y: pv.cy + Math.sqrt(pv.r * pv.r - dx2) };
}

/** Horizontale Verbindung auf Höhe y an der zum Zentrum gerichteten Seite des Kreises. */
function circleInnerHorizontalPoint(
  circle: Circle,
  y: number,
  towardCenter: "left" | "right",
): { x: number; y: number } {
  const clampedY = Math.min(circle.cy + circle.r - 1, Math.max(circle.cy - circle.r + 1, y));
  const dy = clampedY - circle.cy;
  const dx = Math.sqrt(Math.max(0, circle.r * circle.r - dy * dy));
  return {
    x: circle.cx + (towardCenter === "right" ? dx : -dx),
    y: clampedY,
  };
}

/** L-förmiger Pfad: senkrecht, abgerundete 90°-Kurve, horizontal zum Ziel. */
function elbowPath(
  start: { x: number; y: number },
  turnY: number,
  end: { x: number; y: number },
  bend: "left" | "right",
): string {
  const r = Math.min(CORNER_RADIUS, Math.max(8, Math.abs(turnY - start.y) - 4));
  const vx = start.x;
  const elbowX = vx + (bend === "left" ? -r : r);
  return `M ${start.x} ${start.y} L ${vx} ${turnY - r} Q ${vx} ${turnY} ${elbowX} ${turnY} L ${end.x} ${end.y}`;
}

type FlowPaths = {
  pvToVerbrauch: string;
  pvToStromkonto: string;
  gridToVerbrauchBus: string;
};

/**
 * FusionSolar-Linienlayout (Screenshot):
 * zwei parallele Senkrechtstücke unter PV bis auf Höhe der unteren Kreismitten,
 * linkes L in die rechte Seite von Verbrauch, rechtes L in die linke Seite
 * von Stromkonto, darunter eine zweite Horizontale Verbrauch ↔ Stromkonto.
 */
function buildFlowPaths(pv: Circle, verbrauch: Circle, stromkonto: Circle): FlowPaths {
  const leftStart = pvLineStart(pv, "left");
  const rightStart = pvLineStart(pv, "right");

  // Abzweighöhe = Kreismitte der unteren Knoten, nicht die Lücke dazwischen.
  const turnY = verbrauch.cy - SIDE_BRANCH_SPREAD;
  const busY = verbrauch.cy + SIDE_BRANCH_SPREAD;

  const verbrauchTurn = circleInnerHorizontalPoint(verbrauch, turnY, "right");
  const stromkontoTurn = circleInnerHorizontalPoint(stromkonto, turnY, "left");
  const verbrauchBus = circleInnerHorizontalPoint(verbrauch, busY, "right");
  const stromkontoBus = circleInnerHorizontalPoint(stromkonto, busY, "left");

  return {
    pvToVerbrauch: elbowPath(leftStart, turnY, verbrauchTurn, "left"),
    pvToStromkonto: elbowPath(rightStart, turnY, stromkontoTurn, "right"),
    gridToVerbrauchBus: `M ${stromkontoBus.x} ${stromkontoBus.y} L ${verbrauchBus.x} ${verbrauchBus.y}`,
  };
}

/**
 * Misst die tatsächlichen Kreis-Positionen im Diagramm (relativ zum
 * Container), damit die Verbindungslinien und Pfeile exakt an der
 * Kreisgrenze enden/beginnen, statt anhand geschätzter Prozentwerte in den
 * Kreis hinein- oder davor stehen zu bleiben. Reagiert per ResizeObserver
 * auf Breakpoint- und Fenstergrößenänderungen.
 */
function useDiagramGeometry(
  containerRef: RefObject<HTMLDivElement | null>,
  pvRef: RefObject<HTMLDivElement | null>,
  verbrauchRef: RefObject<HTMLDivElement | null>,
  stromkontoRef: RefObject<HTMLDivElement | null>,
): Geometry | null {
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const pv = pvRef.current;
    const verbrauch = verbrauchRef.current;
    const stromkonto = stromkontoRef.current;
    if (!container || !pv || !verbrauch || !stromkonto) return;

    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const toCircle = (el: HTMLDivElement): Circle => {
        const rect = el.getBoundingClientRect();
        return {
          cx: rect.left - containerRect.left + rect.width / 2,
          cy: rect.top - containerRect.top + rect.height / 2,
          r: rect.width / 2,
        };
      };
      setGeometry({
        width: containerRect.width,
        height: containerRect.height,
        pv: toCircle(pv),
        verbrauch: toCircle(verbrauch),
        stromkonto: toCircle(stromkonto),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(pv);
    observer.observe(verbrauch);
    observer.observe(stromkonto);
    const portrait = window.matchMedia(
      "(orientation: portrait) and (min-width: 768px)",
    );
    portrait.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      portrait.removeEventListener("change", measure);
    };
  }, [containerRef, pvRef, verbrauchRef, stromkontoRef]);

  return geometry;
}

export function EnergyFlow({ snapshot, source, gridSource, className }: EnergyFlowProps) {
  const pvSimulated = isPvSimulated(source);
  const gridSimulated = isGridSimulated(gridSource);
  const hideSimulated = useSyncExternalStore(
    hideSimulatedStore.subscribe,
    hideSimulatedStore.getSnapshot,
    hideSimulatedStore.getServerSnapshot,
  );
  const hidePv = hideSimulated && pvSimulated;
  const hideConsumption = hideSimulated && (pvSimulated || gridSimulated);
  const hideGrid = hideSimulated && gridSimulated;
  const gridKw = snapshot.gridKw;
  const hasGrid = gridKw != null;
  const isProducing = snapshot.productionKw > 0.05;
  const isConsuming = (snapshot.consumptionKw ?? 0) > 0.05;
  const gridMeasured = gridSource === "whatwatt" || source === "fusionsolar";
  const isGridImport = gridMeasured && hasGrid && gridKw > 0.05;
  const isGridExport = gridMeasured && hasGrid && gridKw < -0.05;
  const stromkontoKw = gridMeasured && hasGrid ? Math.abs(gridKw) : null;
  const stromkontoNegative =
    snapshot.stromkontoBalanceKwh != null && snapshot.stromkontoBalanceKwh < 0;
  const stromkontoAccent = stromkontoNegative ? "rose" : "amber";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pvCircleRef = useRef<HTMLDivElement | null>(null);
  const pvLabelRef = useRef<HTMLSpanElement | null>(null);
  const verbrauchCircleRef = useRef<HTMLDivElement | null>(null);
  const stromkontoCircleRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const query = window.matchMedia(
      "(orientation: portrait) and (min-width: 768px)",
    );

    const align = () => {
      const label = pvLabelRef.current;
      if (!label) return;
      if (!query.matches) {
        label.style.transform = "";
        return;
      }
      const anchor = document.querySelector<HTMLElement>(
        '[data-kpi-label="ertrag-heute"]',
      );
      if (!anchor) return;
      label.style.transform = "";
      const delta =
        anchor.getBoundingClientRect().top - label.getBoundingClientRect().top;
      label.style.transform = `translateY(${delta}px)`;
    };

    align();
    query.addEventListener("change", align);
    window.addEventListener("resize", align);
    const observer = new ResizeObserver(align);
    if (containerRef.current) observer.observe(containerRef.current);
    const anchor = document.querySelector('[data-kpi-label="ertrag-heute"]');
    const kpiCard = anchor?.closest("[data-slot=card]");
    if (kpiCard) observer.observe(kpiCard);

    return () => {
      query.removeEventListener("change", align);
      window.removeEventListener("resize", align);
      observer.disconnect();
    };
  }, []);
  const geometry = useDiagramGeometry(
    containerRef,
    pvCircleRef,
    verbrauchCircleRef,
    stromkontoCircleRef,
  );

  const consumptionKw = snapshot.consumptionKw ?? 0;
  const directSolarKw = hidePv ? 0 : Math.min(snapshot.productionKw, consumptionKw);
  const pvSurplusKw = hidePv ? 0 : Math.max(0, snapshot.productionKw - consumptionKw);
  const isPvToVerbrauch = directSolarKw > 0.05;
  const isPvToStromkonto = pvSurplusKw > 0.05 || (!hidePv && isGridExport);

  let paths: FlowPaths | null = null;

  if (geometry) {
    paths = buildFlowPaths(geometry.pv, geometry.verbrauch, geometry.stromkonto);
  }

  return (
    <Card className={cn("shadow-card rounded-2xl", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Energiefluss
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        <div
          ref={containerRef}
          className="energy-flow-diagram relative mx-auto h-64 w-full max-w-sm sm:h-72 md:h-52 md:max-w-none lg:h-56"
        >
          {paths ? (
            <svg
              viewBox={`0 0 ${geometry!.width} ${geometry!.height}`}
              className="absolute inset-0 h-full w-full"
            >
              <FlowPath
                d={paths.gridToVerbrauchBus}
                accent={stromkontoAccent}
                active={isGridImport || isGridExport}
                reverse={isGridExport}
              />
              <FlowPath
                d={paths.pvToVerbrauch}
                accent="green"
                active={isPvToVerbrauch}
              />
              <FlowPath
                d={paths.pvToStromkonto}
                accent="green"
                active={isPvToStromkonto}
              />
            </svg>
          ) : null}

          <FlowNode
            circleRef={(el) => {
              pvCircleRef.current = el;
            }}
            icon={<Sun className="size-5" />}
            value={hidePv ? "–" : formatKw(snapshot.productionKw, 2)}
            label="PV"
            accent="green"
            muted={hidePv || !isProducing}
            simulated={!hidePv && pvSimulated}
            labelPosition="top"
            labelRef={(el) => {
              pvLabelRef.current = el;
            }}
            className="energy-flow-node-pv"
            style={{ left: "50%" }}
          />
          <FlowNode
            circleRef={(el) => {
              verbrauchCircleRef.current = el;
            }}
            icon={<Home className="size-5" />}
            value={
              hideConsumption || snapshot.consumptionKw == null
                ? "–"
                : formatKw(snapshot.consumptionKw, 2)
            }
            label="Verbrauch"
            accent="rose"
            muted={hideConsumption || !isConsuming}
            simulated={!hideConsumption && pvSimulated && gridSource !== "whatwatt"}
            labelPosition="bottom"
            className="energy-flow-node-side"
            style={{ left: "16%" }}
          />
          <FlowNode
            circleRef={(el) => {
              stromkontoCircleRef.current = el;
            }}
            icon={<BatteryFull className="size-5 -rotate-90" />}
            value={hideGrid || stromkontoKw == null ? "–" : formatKw(stromkontoKw, 2)}
            label="Stromkonto"
            accent={stromkontoAccent}
            muted={hideGrid || (!isGridImport && !isGridExport)}
            simulated={!hideGrid && gridSimulated}
            labelPosition="bottom"
            className="energy-flow-node-side"
            style={{ left: "84%" }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
