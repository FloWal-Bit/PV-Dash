"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { triggerHaptic } from "@/lib/haptics";
import {
  Area,
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  ComposedChart,
  Line,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type XAxisTickContentProps,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SwipePageSurface } from "@/components/pv/swipe-carousel";
import { SIMULATED_OPACITY_CLASS, isPvSimulated } from "@/lib/data-fidelity";
import { hideSimulatedStore } from "@/lib/hide-simulated";
import { pvStore } from "@/lib/pv-store";
import { withLiveDayTotals } from "@/lib/fusionsolar/mapper";
import type { DailyEnergyPoint, HistoryPoint } from "@/lib/pv-data";
import type { DataSource } from "@/lib/pv-source";
import { formatKw, formatSignedKwh, formatSignedMwh, formatSwissNumber, formatYieldKwh, formatYieldMwh } from "@/lib/format";
import { cn } from "@/lib/utils";

type ChartsSectionProps = {
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
  lifetime: DailyEnergyPoint[];
  source: DataSource;
  /** Live-Tageszähler. Ersetzt nur den Balken „Heute“, ohne FusionSolar erneut abzufragen. */
  liveToday: { yieldKwh: number; consumptionKwh: number | null } | null;
  /** Veränderung des Stromkontos heute, kWh. `null`, wenn sie nicht gemessen ist. */
  stromkontoChangeTodayKwh: number | null;
};

type Range = "heute" | "woche" | "monat" | "jahr" | "lebensdauer";

const RANGE_ORDER: Range[] = ["heute", "woche", "monat", "jahr", "lebensdauer"];
const RANGE_LABELS = ["Heute", "Woche", "Monat", "Jahr", "Laufzeit"];

/** Genug horizontale Breite, um alle Monatstage auf der X-Achse zu benennen. */
const WIDE_MONTH_AXIS_QUERY = "(min-width: 1024px)";

function subscribeWideMonthAxis(onChange: () => void): () => void {
  const media = window.matchMedia(WIDE_MONTH_AXIS_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getWideMonthAxisSnapshot(): boolean {
  return window.matchMedia(WIDE_MONTH_AXIS_QUERY).matches;
}

function getWideMonthAxisServerSnapshot(): boolean {
  return false;
}

type TodayChartPoint = {
  time: string;
  label: string;
  productionKw: number | null;
  consumptionKw: number | null;
  consumedFromPvKw: number | null;
};

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function fiveMinuteLabel(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sampleIntervalHours(points: { time: string }[]): number {
  if (points.length < 2) return 1;
  const delta = parseTimeToMinutes(points[1].time) - parseTimeToMinutes(points[0].time);
  return delta > 0 ? delta / 60 : 1;
}

/**
 * Tageskurve analog FusionSolar: PV-Ausgabe als Fläche, Leistungsaufnahme
 * als rote Linie (gleiche Farbe wie der Verbrauch in Woche und Monat),
 * der Eigenverbrauch als zweite Fläche in einem helleren Grün.
 * Zukünftige Stunden bleiben leer (Kurve endet bei „jetzt“).
 */

/** Gleiche Achsenlage in allen Tabs: Einzug links, Höhe der Zeitachse, Abstand oben. */
const CHART_MARGIN = { top: 28, right: 12, left: 0, bottom: 0 };
const Y_AXIS_WIDTH = 48;
const X_AXIS_HEIGHT = 28;
/** „MWh“ ist die breiteste Einheitenbeschriftung. So weit rückt das Diagramm nach links, damit sie mit „Diese Woche“ abschließt. */
const Y_UNIT_LABEL_WIDTH = 25;
const CHART_PULL_LEFT = Y_AXIS_WIDTH - Y_UNIT_LABEL_WIDTH;
/** Abstand der Y-Einheiten-Baseline vom oberen Plot-Rand (`viewBox.y`). */
const Y_UNIT_LABEL_GAP = 14;
const Y_UNIT_FONT_SIZE = 11;
/**
 * Oberkante des Punktwert-Overlays = Oberkante der Y-Einheitenbeschriftung
 * (kW / kWh / MWh). Horizontal folgt das Overlay weiter dem Punkt.
 */
const CHART_TOOLTIP_TOP = CHART_MARGIN.top - Y_UNIT_LABEL_GAP - Y_UNIT_FONT_SIZE;

/** Zeichenfläche der Kurven, ohne Achsen. Darüber bis zum Kartenrand schliesst ein Tipp die Punktwerte. */
function pointerInDiagram(card: HTMLElement, clientX: number, clientY: number): boolean {
  const surface = card.querySelector(".recharts-surface");
  if (!(surface instanceof SVGSVGElement)) return false;
  const box = surface.getBoundingClientRect();
  return (
    clientX >= box.left + Y_AXIS_WIDTH &&
    clientX <= box.right - CHART_MARGIN.right &&
    clientY >= box.top + CHART_MARGIN.top &&
    clientY <= box.bottom - X_AXIS_HEIGHT
  );
}

function pointerClosesPointValues(card: HTMLElement, clientX: number, clientY: number): boolean {
  const surface = card.querySelector(".recharts-surface");
  if (!(surface instanceof SVGSVGElement)) return false;
  const box = surface.getBoundingClientRect();
  if (clientY > box.bottom) return false;
  return !pointerInDiagram(card, clientX, clientY);
}

/**
 * Recharts setzt den Hover-Index nur bei mousemove/touchmove. Nach dem Tippen
 * und während Touch-Scrub einen Move anstoßen, damit Overlay und X-Achsen-
 * Highlight dem Finger folgen.
 */
function seedChartHoverAt(card: HTMLElement, clientX: number, clientY: number) {
  const wrapper = card.querySelector(".recharts-wrapper");
  if (!(wrapper instanceof HTMLElement)) return;
  wrapper.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window,
    }),
  );
}

/**
 * Hält die X-Achsen-Hervorhebung mit dem aktiven Recharts-Label synchron —
 * auch wenn Touch-Scrub onMouseMove am Chart nicht zuverlässig feuert.
 * Beim Wechsel auf einen neuen Punkt/Balken: kurzes haptisches Feedback.
 */
function ChartActiveLabelBridge({
  label,
  onChange,
  children,
}: {
  label: unknown;
  onChange: (label: string | null) => void;
  children: ReactNode;
}) {
  const text = label == null || label === "" ? null : String(label);
  const previous = useRef<string | null>(null);
  // Layout-Phase: näher am Touch-Event als useEffect (sticky user activation).
  useLayoutEffect(() => {
    onChange(text);
    if (text != null && text !== previous.current) {
      triggerHaptic("selection");
    }
    previous.current = text;
  }, [text, onChange]);
  return <>{children}</>;
}

/** Einheit über der Y-Skala, links bündig mit der Zeile „Diese Woche“. */
function YAxisUnit({
  viewBox,
  value,
}: {
  viewBox?: { x?: number; y?: number; width?: number; cx?: number };
  value?: string | number | boolean | null;
}) {
  if (viewBox?.x == null || viewBox.y == null || viewBox.width == null) return <text />;
  if (typeof value !== "string" && typeof value !== "number") return <text />;
  return (
    <text
      x={viewBox.x + viewBox.width - Y_UNIT_LABEL_WIDTH}
      y={viewBox.y - Y_UNIT_LABEL_GAP}
      textAnchor="start"
      fill="var(--muted-foreground)"
      fontSize={Y_UNIT_FONT_SIZE}
    >
      {value}
    </text>
  );
}

/**
 * Volle Stunden für die Heute-X-Achse.
 * Beschriftet: jede zweite Stunde (00, 02, …). Strich nur in der Mitte dazwischen
 * (01, 03, …) — keine Halbstunden-Striche direkt vor/nach den Zahlen.
 * Smartphone-Hochformat: nur jede vierte Stunde beschriftet (CSS).
 */
function todayHourTicks(): string[] {
  const ticks: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    ticks.push(`${String(hour).padStart(2, "0")}:00`);
  }
  return ticks;
}

/** Nächste beschriftete 2-Stunden-Marke zur Hover-Zeit (z. B. 07:30 → 06:00). */
function todayAxisLabelForSelection(selectedTime: string | null): string | null {
  if (!selectedTime) return null;
  const [hourText] = selectedTime.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return null;
  const evenHour = hour - (hour % 2);
  return `${String(evenHour).padStart(2, "0")}:00`;
}

function TodayAxisTick({
  x,
  y,
  payload,
  selectedTime,
}: XAxisTickContentProps & { selectedTime: string | null }) {
  const value = String(payload?.value ?? "");
  const [hour = "00"] = value.split(":");
  const hourNumber = Number(hour);
  const showLabel = hourNumber % 2 === 0;
  const showTick = hourNumber % 2 === 1;
  const hideOnPhonePortrait = showLabel && hourNumber % 4 !== 0;
  const selectedLabel = todayAxisLabelForSelection(selectedTime);
  const selected = selectedLabel != null && value === selectedLabel;
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`}>
      {showLabel ? (
        <text
          className={hideOnPhonePortrait ? "today-axis-extra" : undefined}
          y={8}
          textAnchor="middle"
          fill={selected ? "var(--card-foreground)" : "var(--muted-foreground)"}
          fontSize={11}
          fontWeight={selected ? 600 : 400}
        >
          {hour}:00
        </text>
      ) : null}
      {/* Nur der mittlere Stundenstrich zwischen zwei Labels — nicht direkt neben der Zahl. */}
      {showTick ? (
        <line
          className="today-axis-tick"
          y2={6}
          stroke={selected ? "var(--card-foreground)" : "var(--muted-foreground)"}
          strokeOpacity={selected ? 0.9 : 0.85}
        />
      ) : null}
    </g>
  );
}

type ChartSeriesVisibility = {
  ertrag: boolean;
  verbrauch: boolean;
  eigenverbrauch: boolean;
};

function TodayPowerChart({
  data,
  series,
  tooltipActive,
}: {
  data: TodayChartPoint[];
  series: ChartSeriesVisibility;
  /** true = Overlay bleibt beim Scrubben sichtbar; false = ausgeblendet. */
  tooltipActive: boolean;
}) {
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [pointerInChart, setPointerInChart] = useState(false);
  const hourTicks = todayHourTicks().filter((tick) => data.some((point) => point.label === tick));

  useEffect(() => {
    if (!tooltipActive && !pointerInChart) setHoverLabel(null);
  }, [tooltipActive, pointerInChart]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
        margin={CHART_MARGIN}
        onMouseMove={(state) => {
          setPointerInChart(true);
          const label = state?.activeLabel;
          setHoverLabel(label == null ? null : String(label));
        }}
        onMouseLeave={() => {
          setPointerInChart(false);
          if (!tooltipActive) setHoverLabel(null);
        }}
      >
        <defs>
          <linearGradient id="fill-pv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.06} />
          </linearGradient>
          <linearGradient id="fill-from-pv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--eigenverbrauch)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--eigenverbrauch)" stopOpacity={0.12} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          ticks={hourTicks}
          interval={0}
          height={X_AXIS_HEIGHT}
          tickLine={false}
          axisLine={false}
          tick={(props) => <TodayAxisTick {...props} selectedTime={hoverLabel} />}
          padding={{ left: 0, right: 0 }}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={Y_AXIS_WIDTH}
          padding={{ top: 0, bottom: 0 }}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(v) => formatSwissNumber(Number(v), 0)}
          label={{ value: "kW", content: YAxisUnit }}
        />
        <Tooltip
          trigger="hover"
          // Cursor/Achsen-Highlight bei Hover; Overlay-Inhalt nur nach Tap.
          active={tooltipActive || pointerInChart}
          // Y fix an der Einheitenbeschriftung; X bleibt im Diagramm (klappt am Rand).
          position={{ y: CHART_TOOLTIP_TOP }}
          allowEscapeViewBox={{ x: false, y: true }}
          // Kein Slide-Delay; seitlicher Abstand, damit die Cursor-Linie nicht unter dem Overlay verschwindet.
          isAnimationActive={false}
          offset={{ x: 16, y: 0 }}
          cursor={{
            stroke: "var(--foreground)",
            strokeOpacity: 0.4,
            strokeWidth: 1,
          }}
          content={(props) => {
            const row = props.payload?.[0]?.payload as TodayChartPoint | undefined;
            const hours = sampleIntervalHours(data);
            const stromkonto =
              !row || row.productionKw == null || row.consumptionKw == null
                ? "–"
                : formatSignedKwh((row.productionKw - row.consumptionKw) * hours, 2);
            return (
              <ChartActiveLabelBridge label={props.label ?? row?.label} onChange={setHoverLabel}>
                {!tooltipActive || !row ? null : (
                  <DetailTooltip
                    title={String(props.label ?? row.label)}
                    rows={[
                      ...(series.ertrag
                        ? [
                            {
                              label: "Ertrag",
                              value: row.productionKw == null ? "–" : formatKw(row.productionKw, 2),
                            },
                          ]
                        : []),
                      ...(series.verbrauch
                        ? [
                            {
                              label: "Verbrauch",
                              value:
                                row.consumptionKw == null ? "–" : formatKw(row.consumptionKw, 2),
                            },
                          ]
                        : []),
                      ...(series.eigenverbrauch
                        ? [
                            {
                              label: "Eigenverbrauch",
                              value:
                                row.consumedFromPvKw == null
                                  ? "–"
                                  : formatKw(row.consumedFromPvKw, 2),
                            },
                          ]
                        : []),
                      { label: "Stromkonto", value: stromkonto },
                    ]}
                  />
                )}
              </ChartActiveLabelBridge>
            );
          }}
        />
        {series.ertrag ? (
          <Area
            className="today-ertrag"
            type="monotone"
            dataKey="productionKw"
            name="productionKw"
            stroke="var(--chart-3)"
            strokeWidth={2}
            fill="url(#fill-pv)"
            dot={false}
            activeDot={{ r: 3 }}
            connectNulls={false}
          />
        ) : null}
        {series.eigenverbrauch ? (
          <Area
            className="today-eigenverbrauch"
            type="monotone"
            dataKey="consumedFromPvKw"
            name="consumedFromPvKw"
            stroke="var(--eigenverbrauch)"
            strokeWidth={1.5}
            fill="url(#fill-from-pv)"
            dot={false}
            activeDot={{ r: 3 }}
            connectNulls={false}
          />
        ) : null}
        {series.verbrauch ? (
          <Line
            className="today-verbrauch"
            type="linear"
            dataKey="consumptionKw"
            name="consumptionKw"
            stroke="var(--chart-5)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            connectNulls={false}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

type EnergyUnit = "kWh" | "MWh";

function toDisplayEnergy(valueKwh: number, unit: EnergyUnit): number {
  return unit === "MWh" ? valueKwh / 1000 : valueKwh;
}

/** Unter 10 MWh zwei Nachkommastellen, sonst eine. */
function mwhFractionDigits(valueMwh: number): number {
  return valueMwh < 10 ? 2 : 1;
}

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function axisTickLabel(value: unknown): string {
  const text = String(value ?? "");
  if (text !== "Dieser Monat") return text;
  const { month } = zurichYearMonth();
  return MONTHS_DE[month - 1] ?? text;
}

/**
 * Nächste beschriftete X-Achsen-Marke (Recharts `interval`): Index 0, step, 2·step, …
 * Damit das Highlight beim Scrubben sichtbar mitläuft, auch wenn nicht jeder Balken
 * eine Achsenbeschriftung hat.
 */
function nearestLabeledBarLabel(
  labels: string[],
  selectedLabel: string | null,
  tickInterval: number,
): string | null {
  if (!selectedLabel) return null;
  const index = labels.indexOf(selectedLabel);
  if (index < 0) return selectedLabel;
  const step = Math.max(1, tickInterval + 1);
  const nearest = Math.min(labels.length - 1, Math.round(index / step) * step);
  return labels[nearest] ?? selectedLabel;
}

/** X-Achsen-Tick: ausgewählter Tag/Monat/Jahr fett und stärker kontrastiert. */
function BarAxisTick({
  x,
  y,
  payload,
  selectedLabel,
  compact = false,
}: XAxisTickContentProps & { selectedLabel: string | null; compact?: boolean }) {
  const raw = String(payload?.value ?? "");
  const selected = selectedLabel != null && raw === selectedLabel;
  return (
    <text
      x={Number(x)}
      y={Number(y) + 12}
      textAnchor="middle"
      fill={selected ? "var(--card-foreground)" : "var(--muted-foreground)"}
      fontSize={compact ? 9 : 11}
      fontWeight={selected ? 600 : 400}
    >
      {axisTickLabel(raw)}
    </text>
  );
}

/** Kräftigere Selection-Spalte hinter dem aktiven Balken (Option D). */
function BarSelectionCursor(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0 } = props;
  if (width <= 0 || height <= 0) return null;
  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      fill="var(--foreground)"
      fillOpacity={0.1}
      radius={4}
    />
  );
}

function zurichYearMonth(now = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function emptyBarPoint(label: string): DailyEnergyPoint {
  return {
    label,
    yieldKwh: 0,
    consumptionKwh: 0,
    directSolarKwh: 0,
    batteryKwh: 0,
  };
}

/** Kalendertage des Monats (1–12), unabhängig von der Zeitzone der Laufzeit. */
function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Monatsachse immer mit allen Tagen 1…N füllen — auch ohne Messwerte
 * (künftige Tage und Lücken in der Quelle als 0).
 */
function padMonthDays(points: DailyEnergyPoint[], now = new Date()): DailyEnergyPoint[] {
  const { year, month } = zurichYearMonth(now);
  const todayLabel = zurichDayLabel(now);
  const byLabel = new Map<string, DailyEnergyPoint>();
  for (const point of points) {
    const label = point.label === "Heute" ? todayLabel : point.label;
    byLabel.set(label, { ...point, label });
  }
  const padded: DailyEnergyPoint[] = [];
  const days = daysInCalendarMonth(year, month);
  for (let day = 1; day <= days; day++) {
    const label = String(day);
    padded.push(byLabel.get(label) ?? emptyBarPoint(label));
  }
  return padded;
}

/**
 * Jahresachse immer mit allen 12 Monaten füllen — auch ohne Messwerte
 * (künftige Monate und Lücken in der Quelle als 0).
 */
function padYearMonths(points: DailyEnergyPoint[], now = new Date()): DailyEnergyPoint[] {
  const { month: currentMonth } = zurichYearMonth(now);
  const byMonth = new Map<number, DailyEnergyPoint>();
  for (const point of points) {
    if (point.label === "Dieser Monat") {
      byMonth.set(currentMonth, point);
      continue;
    }
    const index = MONTHS_DE.indexOf(point.label);
    if (index >= 0) byMonth.set(index + 1, point);
  }
  const padded: DailyEnergyPoint[] = [];
  for (let month = 1; month <= 12; month++) {
    const label = month === currentMonth ? "Dieser Monat" : MONTHS_DE[month - 1];
    const existing = byMonth.get(month);
    padded.push(existing ? { ...existing, label } : emptyBarPoint(label));
  }
  return padded;
}

/** Tooltip: „Samstag, 3. Oktober“. */
function calendarDayTitle(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

/** Tooltip in der Monatsansicht: „3“ wird zu „Samstag, 3. Oktober“. */
function monthDayTooltipTitle(dayLabel: string, now = new Date()): string {
  if (!/^\d{1,2}$/.test(dayLabel)) return dayLabel;
  const { year, month } = zurichYearMonth(now);
  return calendarDayTitle(year, month, Number(dayLabel));
}

function weekDayTooltipTitle(dayKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  return calendarDayTitle(Number(match[1]), Number(match[2]), Number(match[3]));
}

const WEEKDAY_FULL: Record<string, string> = {
  Mo: "Montag",
  Di: "Dienstag",
  Mi: "Mittwoch",
  Do: "Donnerstag",
  Fr: "Freitag",
  Sa: "Samstag",
  So: "Sonntag",
};

/** Tooltip in der Jahresansicht: „Mär“ wird zu „März“. */
const MONTH_FULL: Record<string, string> = {
  Jan: "Januar",
  Feb: "Februar",
  Mär: "März",
  Apr: "April",
  Mai: "Mai",
  Jun: "Juni",
  Jul: "Juli",
  Aug: "August",
  Sep: "September",
  Okt: "Oktober",
  Nov: "November",
  Dez: "Dezember",
};

const tooltipBoxStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--popover-foreground)",
  padding: "8px 10px",
  // Schmal genug, damit Recharts am rechten Rand nach links klappen kann.
  maxWidth: 180,
  boxSizing: "border-box" as const,
  whiteSpace: "normal" as const,
  overflowWrap: "anywhere" as const,
};

function DetailTooltip({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <div style={tooltipBoxStyle}>
      {title ? <div style={{ marginBottom: 4 }}>{title}</div> : null}
      {rows.map((row) => (
        <div key={row.label}>
          {row.label} : {row.value}
        </div>
      ))}
    </div>
  );
}

function formatDetailEnergy(amount: number, unit: EnergyUnit, trimDecimal: boolean): string {
  if (unit === "MWh") {
    const digits = Math.max(0, mwhFractionDigits(Math.abs(amount)) - (trimDecimal ? 1 : 0));
    return `${formatSwissNumber(amount, digits)} MWh`;
  }
  return formatYieldKwh(amount, 1);
}

function formatDetailStromkonto(kwh: number, unit: EnergyUnit, trimDecimal: boolean): string {
  if (unit === "MWh") {
    const digits = Math.max(0, mwhFractionDigits(Math.abs(kwh) / 1000) - (trimDecimal ? 1 : 0));
    return formatSignedMwh(kwh, digits);
  }
  return formatSignedKwh(kwh, 1);
}
function barTooltipTitle(
  label: unknown,
  row: { dayKey?: string },
  options: {
    expandWeekdayLabel: boolean;
    expandMonthDayLabel: boolean;
    expandMonthNameLabel: boolean;
  },
): string {
  const text = String(label ?? "");
  if (options.expandWeekdayLabel) {
    if (typeof row.dayKey === "string") return weekDayTooltipTitle(row.dayKey) ?? (WEEKDAY_FULL[text] ?? text);
    return WEEKDAY_FULL[text] ?? text;
  }
  if (options.expandMonthDayLabel) return monthDayTooltipTitle(text);
  if (options.expandMonthNameLabel) return MONTH_FULL[text] ?? text;
  return text;
}

/** Ertrag und Verbrauch nebeneinander. Der Eigenverbrauch liegt unten in der Ertragssäule. */
function YieldConsumptionChart({
  data,
  unit = "kWh",
  trimDecimal = false,
  expandWeekdayLabel = false,
  expandMonthDayLabel = false,
  expandMonthNameLabel = false,
  showStromkonto = true,
  /** Monat im Widescreen: jeden Tag auf der X-Achse beschriften. */
  labelAllDays = false,
  series,
  tooltipActive,
}: {
  data: DailyEnergyPoint[];
  unit?: EnergyUnit;
  /** Eine Nachkommastelle weniger, nur für „Dieses Jahr“. */
  trimDecimal?: boolean;
  /** Tooltip-Titel: Mo wird zu Montag. Die Achse bleibt kurz. */
  expandWeekdayLabel?: boolean;
  /** Tooltip-Titel: 3 wird zu Samstag, 3. Oktober. Die Achse bleibt die Zahl. */
  expandMonthDayLabel?: boolean;
  /** Tooltip-Titel: Mär wird zu März. Die Achse bleibt kurz. */
  expandMonthNameLabel?: boolean;
  /** Laufzeit zeigt keine Stromkonto-Zeile. */
  showStromkonto?: boolean;
  labelAllDays?: boolean;
  series: ChartSeriesVisibility;
  /** true = Overlay bleibt beim Scrubben sichtbar; false = ausgeblendet. */
  tooltipActive: boolean;
}) {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [pointerInChart, setPointerInChart] = useState(false);
  const tickInterval =
    labelAllDays || data.length <= 14 ? 0 : Math.ceil(data.length / 10) - 1;
  const axisLabels = useMemo(() => data.map((point) => point.label), [data]);
  const highlightedLabel = nearestLabeledBarLabel(axisLabels, selectedLabel, tickInterval);
  const chartData = useMemo(
    () =>
      data.map((point) => {
        const eigenKwh = point.directSolarKwh + point.batteryKwh;
        const both = series.ertrag && series.eigenverbrauch;
        return {
          ...point,
          stromkontoKwh: point.yieldKwh - point.consumptionKwh,
          yieldKwh: toDisplayEnergy(point.yieldKwh, unit),
          consumptionKwh: toDisplayEnergy(point.consumptionKwh, unit),
          eigenverbrauchKwh: toDisplayEnergy(eigenKwh, unit),
          // Grün oben, Petrol unten, zusammen genau so hoch wie der Ertrag.
          yieldSegmentKwh: series.ertrag
            ? toDisplayEnergy(both ? Math.max(0, point.yieldKwh - eigenKwh) : point.yieldKwh, unit)
            : 0,
          eigenSegmentKwh: series.eigenverbrauch
            ? toDisplayEnergy(both ? Math.min(eigenKwh, point.yieldKwh) : eigenKwh, unit)
            : 0,
        };
      }),
    [data, series.eigenverbrauch, series.ertrag, unit],
  );

  useEffect(() => {
    if (!tooltipActive && !pointerInChart) setSelectedLabel(null);
  }, [tooltipActive, pointerInChart]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        margin={CHART_MARGIN}
        barGap={2}
        onMouseMove={(state) => {
          setPointerInChart(true);
          const label = state?.activeLabel;
          setSelectedLabel(label == null ? null : String(label));
        }}
        onMouseLeave={() => {
          setPointerInChart(false);
          if (!tooltipActive) setSelectedLabel(null);
        }}
      >
        <defs>
          <linearGradient id="bar-yield" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id="bar-consumption" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id="bar-eigenverbrauch" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--eigenverbrauch)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--eigenverbrauch)" stopOpacity={0.55} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          height={X_AXIS_HEIGHT}
          interval={tickInterval}
          padding={{ left: 0, right: 0 }}
          tick={(props) => (
            <BarAxisTick
              {...props}
              selectedLabel={highlightedLabel}
              compact={labelAllDays}
            />
          )}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={Y_AXIS_WIDTH}
          padding={{ top: 0, bottom: 0 }}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(v) => formatSwissNumber(Number(v), 0)}
          label={{ value: unit, content: YAxisUnit }}
        />
        <Tooltip
          trigger="hover"
          // Selection-Spalte/Achse bei Hover; Overlay-Inhalt nur nach Tap.
          active={tooltipActive || pointerInChart}
          position={{ y: CHART_TOOLTIP_TOP }}
          allowEscapeViewBox={{ x: false, y: true }}
          isAnimationActive={false}
          offset={{ x: 12, y: 0 }}
          cursor={<BarSelectionCursor />}
          content={(props) => {
            const row = props.payload?.[0]?.payload as
              | {
                  dayKey?: string;
                  yieldKwh?: number;
                  consumptionKwh?: number;
                  eigenverbrauchKwh?: number;
                  stromkontoKwh?: number;
                }
              | undefined;
            return (
              <ChartActiveLabelBridge label={props.label} onChange={setSelectedLabel}>
                {!tooltipActive || !row ? null : (
                  <DetailTooltip
                    title={barTooltipTitle(props.label, row, {
                      expandWeekdayLabel,
                      expandMonthDayLabel,
                      expandMonthNameLabel,
                    })}
                    rows={[
                      ...(series.ertrag
                        ? [
                            {
                              label: "Ertrag",
                              value: formatDetailEnergy(
                                Number(row.yieldKwh ?? 0),
                                unit,
                                trimDecimal,
                              ),
                            },
                          ]
                        : []),
                      ...(series.verbrauch
                        ? [
                            {
                              label: "Verbrauch",
                              value: formatDetailEnergy(
                                Number(row.consumptionKwh ?? 0),
                                unit,
                                trimDecimal,
                              ),
                            },
                          ]
                        : []),
                      ...(series.eigenverbrauch
                        ? [
                            {
                              label: "Eigenverbrauch",
                              value: formatDetailEnergy(
                                Number(row.eigenverbrauchKwh ?? 0),
                                unit,
                                trimDecimal,
                              ),
                            },
                          ]
                        : []),
                      ...(showStromkonto
                        ? [
                            {
                              label: "Stromkonto",
                              value: formatDetailStromkonto(
                                Number(row.stromkontoKwh ?? 0),
                                unit,
                                trimDecimal,
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </ChartActiveLabelBridge>
            );
          }}
        />
        <BarStack stackId="ertrag" radius={[6, 6, 6, 6]}>
          <Bar
            dataKey="eigenSegmentKwh"
            fill="url(#bar-eigenverbrauch)"
            maxBarSize={16}
            isAnimationActive={false}
          />
          <Bar
            dataKey="yieldSegmentKwh"
            fill="url(#bar-yield)"
            maxBarSize={16}
            isAnimationActive={false}
          />
        </BarStack>
        {series.verbrauch ? (
          <Bar
            dataKey="consumptionKwh"
            fill="url(#bar-consumption)"
            radius={[6, 6, 6, 6]}
            maxBarSize={16}
          />
        ) : null}
      </BarChart>
    </ResponsiveContainer>
  );
}

function todayEnergyDataMissing(
  points: TodayChartPoint[],
  liveToday: ChartsSectionProps["liveToday"],
): boolean {
  const hasYield =
    (liveToday?.yieldKwh ?? 0) > 0 || points.some((point) => (point.productionKw ?? 0) > 0);
  const hasConsumption =
    (liveToday?.consumptionKwh ?? 0) > 0 ||
    points.some((point) => point.consumptionKw != null && point.consumptionKw > 0);
  return !hasYield && !hasConsumption;
}

function lifetimeWithout2021(points: DailyEnergyPoint[]): DailyEnergyPoint[] {
  return points.filter((point) => point.label !== "2021");
}

function formatRangeTotal(
  range: Range,
  today: HistoryPoint[],
  todayChartData: TodayChartPoint[],
  week: DailyEnergyPoint[],
  month: DailyEnergyPoint[],
  year: DailyEnergyPoint[],
  lifetime: DailyEnergyPoint[],
  liveToday: ChartsSectionProps["liveToday"],
  stromkontoChangeTodayKwh: number | null,
): string {
  if (range === "heute") {
    const hours = sampleIntervalHours(today);
    const yieldKwh = todayChartData.reduce(
      (sum, point) => sum + (point.productionKw ?? 0) * hours,
      0,
    );
    const measured = todayChartData.filter((point) => point.consumptionKw != null);
    const summedKwh = measured.reduce((sum, point) => sum + (point.consumptionKw ?? 0) * hours, 0);
    const consumptionKwh = liveToday?.consumptionKwh ?? (measured.length > 0 ? summedKwh : null);
    const consumption =
      consumptionKwh == null ? "–" : formatYieldKwh(consumptionKwh, 1);
    const stromkonto =
      stromkontoChangeTodayKwh == null ? "–" : formatSignedKwh(stromkontoChangeTodayKwh, 1);
    return `Heute: ${formatYieldKwh(yieldKwh, 1)} / ${consumption} / ${stromkonto}`;
  }
  const points =
    range === "woche"
      ? week
      : range === "monat"
        ? month
        : range === "jahr"
          ? year
          : lifetimeWithout2021(lifetime);
  const yieldKwh = points.reduce((sum, point) => sum + point.yieldKwh, 0);
  const consumptionKwh = points.reduce((sum, point) => sum + point.consumptionKwh, 0);
  const periodLabel: Record<Exclude<Range, "heute">, string> = {
    woche: "Letzte 7 Tage",
    monat: "Dieser Monat",
    jahr: "Dieses Jahr",
    lebensdauer: "Laufzeit",
  };
  const label = periodLabel[range as Exclude<Range, "heute">];
  if (range === "lebensdauer") {
    const yieldDigits = mwhFractionDigits(yieldKwh / 1000);
    const consumptionDigits = mwhFractionDigits(consumptionKwh / 1000);
    return `${label}: ${formatYieldMwh(yieldKwh, yieldDigits)} / ${formatYieldMwh(consumptionKwh, consumptionDigits)} / -`;
  }
  const stromkontoKwh = yieldKwh - consumptionKwh;
  if (range === "jahr") {
    const trim = 1;
    const yieldDigits = Math.max(0, mwhFractionDigits(yieldKwh / 1000) - trim);
    const consumptionDigits = Math.max(0, mwhFractionDigits(consumptionKwh / 1000) - trim);
    const stromkontoDigits = Math.max(0, mwhFractionDigits(Math.abs(stromkontoKwh) / 1000) - trim);
    return `${label}: ${formatYieldMwh(yieldKwh, yieldDigits)} / ${formatYieldMwh(consumptionKwh, consumptionDigits)} / ${formatSignedMwh(stromkontoKwh, stromkontoDigits)}`;
  }
  return `${label}: ${formatYieldKwh(yieldKwh, 0)} / ${formatYieldKwh(consumptionKwh, 0)} / ${formatSignedKwh(stromkontoKwh, 0)}`;
}

function RangeTotal({ text }: { text: string }) {
  const splitAt = text.indexOf(": ");
  if (splitAt === -1) return text;
  return (
    <>
      {text.slice(0, splitAt + 2)}
      <span className="text-card-foreground">{text.slice(splitAt + 2)}</span>
    </>
  );
}

/**
 * Tageslabel der Monatsansicht: unpaddingt wie in `mapDaySeriesToMonth`
 * (`String(parts.day)` → "1"…"31"). `day: "2-digit"` würde "01" liefern und
 * das Live-Overlay an den Tagen 1–9 verfehlen.
 */
function zurichDayLabel(date = new Date()): string {
  return String(
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Zurich",
        day: "numeric",
      }).format(date),
    ),
  );
}

function applyLiveToday(
  points: DailyEnergyPoint[],
  liveToday: ChartsSectionProps["liveToday"],
  isToday: (point: DailyEnergyPoint) => boolean,
  /** Wenn gesetzt und heute fehlt in der Reihe: heutigen Live-Punkt anhängen. */
  seedLabelWhenMissing?: string,
): DailyEnergyPoint[] {
  if (!liveToday) return points;
  let found = false;
  const next = points.map((point) => {
    if (!isToday(point)) return point;
    found = true;
    return withLiveDayTotals(
      point,
      liveToday.yieldKwh,
      liveToday.consumptionKwh ?? point.consumptionKwh,
    );
  });
  // Am 1. eines Monats liefert FusionSolar oft noch keine Tagesreihe — dann
  // den heutigen Live-Stand als ersten Balken ergänzen (erst sobald gemessen).
  const hasLive =
    liveToday.yieldKwh > 0 || (liveToday.consumptionKwh != null && liveToday.consumptionKwh > 0);
  if (!found && seedLabelWhenMissing && hasLive) {
    next.push(
      withLiveDayTotals(
        {
          label: seedLabelWhenMissing,
          yieldKwh: 0,
          consumptionKwh: 0,
          directSolarKwh: 0,
          batteryKwh: 0,
        },
        liveToday.yieldKwh,
        liveToday.consumptionKwh ?? 0,
      ),
    );
  }
  return next;
}

export function ChartsSection({
  today,
  week,
  month,
  year,
  lifetime,
  source,
  liveToday,
  stromkontoChangeTodayKwh,
}: ChartsSectionProps) {
  const [page, setPage] = useState(0);
  const [series, setSeries] = useState<ChartSeriesVisibility>({
    ertrag: true,
    verbrauch: true,
    eigenverbrauch: false,
  });
  /**
   * Detailwerte erst nach Tippen aufs Diagramm. Offen bleiben sie beim
   * Horizontal-Scrubben (hover-trigger); Tipp ausserhalb oder Tab-Wechsel schliesst.
   */
  const [tooltipDismissed, setTooltipDismissed] = useState(true);
  const suppressChartOpenUntil = useRef(0);
  const tooltipOpen = !tooltipDismissed;
  const range = RANGE_ORDER[page] ?? "heute";
  const pvSimulated = isPvSimulated(source);
  const hideSimulated = useSyncExternalStore(
    hideSimulatedStore.subscribe,
    hideSimulatedStore.getSnapshot,
    hideSimulatedStore.getServerSnapshot,
  );
  const wideMonthAxis = useSyncExternalStore(
    subscribeWideMonthAxis,
    getWideMonthAxisSnapshot,
    getWideMonthAxisServerSnapshot,
  );
  const hidePv = hideSimulated && pvSimulated;

  const todayChartData = useMemo((): TodayChartPoint[] => {
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const byLabel = new Map(today.map((point) => [point.label, point]));
    const points: TodayChartPoint[] = [];
    for (let minutes = 0; minutes <= 24 * 60; minutes += 5) {
      const label = fiveMinuteLabel(minutes);
      const source = byLabel.get(label);
      const isFuture = minutes > nowMinutes;
      if (!source || isFuture) {
        points.push({
          time: label,
          label,
          productionKw: null,
          consumptionKw: null,
          consumedFromPvKw: null,
        });
        continue;
      }
      points.push({
        time: source.time,
        label: source.label,
        productionKw: source.productionKw,
        consumptionKw: source.consumptionKw,
        consumedFromPvKw:
          source.consumptionKw == null
            ? null
            : Math.min(source.productionKw, source.consumptionKw),
      });
    }
    return points;
  }, [today]);

  const todayDayLabel = zurichDayLabel();
  const weekWithLive = useMemo(
    () => applyLiveToday(week, liveToday, (point) => point.label === "Heute"),
    [week, liveToday],
  );
  const monthWithLive = useMemo(
    () =>
      applyLiveToday(
        padMonthDays(month),
        liveToday,
        (point) => point.label === todayDayLabel,
        todayDayLabel,
      ),
    [month, liveToday, todayDayLabel],
  );

  /** Jahresbalken „Dieser Monat“ aus der (ggf. live ergänzten) Monatsreihe. */
  const yearWithLive = useMemo(() => {
    const yearPadded = padYearMonths(year);
    if (!liveToday) return yearPadded;
    const sum = (key: keyof Pick<DailyEnergyPoint, "yieldKwh" | "consumptionKwh" | "directSolarKwh" | "batteryKwh">) =>
      Math.round(monthWithLive.reduce((total, point) => total + point[key], 0) * 10) / 10;
    const yieldKwh = sum("yieldKwh");
    const consumptionKwh = sum("consumptionKwh");
    const directSolarKwh = sum("directSolarKwh");
    const batteryKwh = sum("batteryKwh");
    let found = false;
    const next = yearPadded.map((point) => {
      if (point.label !== "Dieser Monat") return point;
      found = true;
      return { ...point, yieldKwh, consumptionKwh, directSolarKwh, batteryKwh };
    });
    if (!found) {
      next.push({
        label: "Dieser Monat",
        yieldKwh,
        consumptionKwh,
        directSolarKwh,
        batteryKwh,
      });
    }
    return next;
  }, [year, monthWithLive, liveToday]);

  const total = useMemo(
    () =>
      formatRangeTotal(
        range,
        today,
        todayChartData,
        weekWithLive,
        monthWithLive,
        yearWithLive,
        lifetime,
        liveToday,
        stromkontoChangeTodayKwh,
      ),
    [range, today, todayChartData, weekWithLive, monthWithLive, yearWithLive, lifetime, liveToday, stromkontoChangeTodayKwh],
  );

  const barData =
    range === "woche"
      ? weekWithLive
      : range === "monat"
        ? monthWithLive
        : range === "jahr"
          ? yearWithLive
          : lifetimeWithout2021(lifetime);
  const todayEnergyMissing = range === "heute" && todayEnergyDataMissing(todayChartData, liveToday);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const scrubPointerId = useRef<number | null>(null);

  useLayoutEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)");
    const card = cardRef.current;

    const matchWeatherCard = () => {
      if (!card) return;
      if (!phone.matches) {
        card.style.height = "";
        return;
      }
      const weather = document.querySelector<HTMLElement>("[data-sun-times-card]");
      if (!weather) {
        card.style.height = "";
        return;
      }
      card.style.height = `${Math.round(weather.getBoundingClientRect().height)}px`;
    };

    matchWeatherCard();
    phone.addEventListener("change", matchWeatherCard);
    window.addEventListener("resize", matchWeatherCard);
    const weather = document.querySelector("[data-sun-times-card]");
    const weatherObserver = new ResizeObserver(matchWeatherCard);
    if (weather) weatherObserver.observe(weather);

    return () => {
      phone.removeEventListener("change", matchWeatherCard);
      window.removeEventListener("resize", matchWeatherCard);
      weatherObserver.disconnect();
      if (card) card.style.height = "";
    };
  }, []);

  return (
    <Card
      ref={cardRef}
      className="yield-chart-card shadow-card rounded-2xl"
      onPointerDown={(event) => {
        const card = event.currentTarget;
        // Nur Öffnen/Schliessen — kein Pointer-Capture auf der ganzen Karte,
        // sonst blockiert Tab-Swipe ausserhalb des Diagramms.
        if (pointerClosesPointValues(card, event.clientX, event.clientY)) {
          scrubPointerId.current = null;
          setTooltipDismissed(true);
          return;
        }
        if (
          pointerInDiagram(card, event.clientX, event.clientY) &&
          Date.now() >= suppressChartOpenUntil.current
        ) {
          setTooltipDismissed(false);
          seedChartHoverAt(card, event.clientX, event.clientY);
        }
      }}
    >
      <SwipePageSurface
        labels={RANGE_LABELS}
        page={page}
        ignoreSwipeSelector=".yield-chart-plot"
        onPageChange={(next) => {
          setTooltipDismissed(true);
          if (next !== page) suppressChartOpenUntil.current = Date.now() + 400;
          setPage(next);
          if (next !== page) pvStore.refreshHistory();
        }}
        className="yield-chart-surface min-h-0 flex-1 pb-1"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-(--card-spacing)">
          <CardHeader className="-mt-(--card-spacing) pt-(--card-spacing)">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Ertrag / Verbrauch / Stromkonto
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {hidePv ? (
                  "Simulierte Verläufe sind ausgeblendet"
                ) : (
                  <RangeTotal text={total} />
                )}
              </span>
            </div>
          </CardHeader>
          <CardContent className="yield-chart-body">
            <div className="yield-chart-stack flex flex-col gap-3">
              <div
                className={cn(
                  "yield-chart-plot h-56 min-w-0 landscape:h-64 sm:h-72 transition-opacity",
                  tooltipOpen && "touch-none",
                  !hidePv && pvSimulated && SIMULATED_OPACITY_CLASS,
                )}
                style={
                  hidePv || todayEnergyMissing
                    ? undefined
                    : { marginLeft: -CHART_PULL_LEFT, width: `calc(100% + ${CHART_PULL_LEFT}px)` }
                }
                onPointerDown={(event) => {
                  const card = cardRef.current;
                  if (!card) return;
                  if (
                    !pointerInDiagram(card, event.clientX, event.clientY) ||
                    Date.now() < suppressChartOpenUntil.current
                  ) {
                    return;
                  }
                  // Capture nur auf dem Plot — Header/Legende bleiben tab-swipebar.
                  scrubPointerId.current = event.pointerId;
                  try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                  } catch {
                    /* ältere WebViews ohne Capture */
                  }
                }}
                onPointerMove={(event) => {
                  if (scrubPointerId.current !== event.pointerId) return;
                  const card = cardRef.current;
                  if (!card) return;
                  if (!pointerInDiagram(card, event.clientX, event.clientY)) return;
                  seedChartHoverAt(card, event.clientX, event.clientY);
                }}
                onPointerUp={(event) => {
                  if (scrubPointerId.current !== event.pointerId) return;
                  scrubPointerId.current = null;
                  try {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  } catch {
                    /* bereits freigegeben */
                  }
                }}
                onPointerCancel={(event) => {
                  if (scrubPointerId.current !== event.pointerId) return;
                  scrubPointerId.current = null;
                }}
              >
                {hidePv ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    Keine gemessenen Verlaufsdaten.
                  </div>
                ) : todayEnergyMissing ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    Für heute liegen noch keine Ertrags- und Verbrauchsdaten vor.
                  </div>
                ) : range === "heute" ? (
                  <TodayPowerChart data={todayChartData} series={series} tooltipActive={tooltipOpen} />
                ) : (
                  <YieldConsumptionChart
                    data={barData}
                    unit={range === "jahr" || range === "lebensdauer" ? "MWh" : "kWh"}
                    trimDecimal={range === "jahr"}
                    expandWeekdayLabel={range === "woche"}
                    expandMonthDayLabel={range === "monat"}
                    expandMonthNameLabel={range === "jahr"}
                    showStromkonto={range !== "lebensdauer"}
                    labelAllDays={range === "monat" && wideMonthAxis}
                    series={series}
                    tooltipActive={tooltipOpen}
                  />
                )}
              </div>
              <div
                className={cn(
                  "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground transition-opacity",
                  !hidePv && pvSimulated && SIMULATED_OPACITY_CLASS,
                  hidePv && "invisible",
                )}
              >
                {(
                  [
                    ["ertrag", "Ertrag", "bg-chart-3", "border-chart-3"],
                    ["verbrauch", "Verbrauch", "bg-chart-5", "border-chart-5"],
                    ["eigenverbrauch", "Eigenverbrauch", "bg-eigenverbrauch", "border-eigenverbrauch"],
                  ] as const
                ).map(([key, label, fill, ring]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={series[key]}
                    onClick={() => setSeries((current) => ({ ...current, [key]: !current[key] }))}
                    className="flex cursor-pointer items-center gap-1.5"
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full box-border",
                        series[key] ? fill : `border ${ring}`,
                      )}
                    />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </div>
      </SwipePageSurface>
    </Card>
  );
}
