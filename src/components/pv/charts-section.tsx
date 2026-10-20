"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
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
      y={viewBox.y - 14}
      textAnchor="start"
      fill="var(--muted-foreground)"
      fontSize={11}
    >
      {value}
    </text>
  );
}

/** Volle und halbe Stunde. Beschriftet wird jede zweite Stunde. Im Hochformat auf dem Smartphone nur jede vierte, sonst überlagern sich die Zeiten. */
function halfHourTicks(): string[] {
  const ticks: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const hh = String(hour).padStart(2, "0");
    ticks.push(`${hh}:00`, `${hh}:30`);
  }
  return ticks;
}

function TodayAxisTick({ x, y, payload }: XAxisTickContentProps) {
  const value = String(payload?.value ?? "");
  const [hour = "00", minute = "00"] = value.split(":");
  const halfHour = minute === "30";
  const hourNumber = Number(hour);
  const showLabel = !halfHour && hourNumber % 2 === 0;
  const hideOnPhonePortrait = showLabel && hourNumber % 4 !== 0;
  const shownLabelHour = !halfHour && hourNumber % 4 === 0;
  const underShownLabel =
    (halfHour && (hourNumber % 4 === 0 || hourNumber % 4 === 3)) ||
    (!halfHour && (hourNumber % 4 === 1 || hourNumber % 4 === 3));
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`}>
      {showLabel ? (
        <text
          className={hideOnPhonePortrait ? "today-axis-extra" : undefined}
          y={8}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize={11}
        >
          {hour}:00
        </text>
      ) : null}
      {shownLabelHour ? null : (
        <line
          className={
            hideOnPhonePortrait
              ? "today-axis-fallback-tick"
              : underShownLabel
                ? "today-axis-near-label"
                : undefined
          }
          y2={halfHour ? 4 : 6}
          stroke="var(--muted-foreground)"
          strokeOpacity={halfHour ? 0.55 : 0.85}
        />
      )}
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
}: {
  data: TodayChartPoint[];
  series: ChartSeriesVisibility;
}) {
  const hourTicks = halfHourTicks().filter((tick) => data.some((point) => point.label === tick));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={CHART_MARGIN}>
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
          tick={TodayAxisTick}
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
          cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.35 }}
          content={(props) => {
            if (!props.active || !props.payload?.length) return null;
            const row = props.payload[0]?.payload as TodayChartPoint | undefined;
            if (!row) return null;
            const hours = sampleIntervalHours(data);
            const stromkonto =
              row.productionKw == null || row.consumptionKw == null
                ? "–"
                : formatSignedKwh((row.productionKw - row.consumptionKw) * hours, 2);
            return (
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
                          value: row.consumptionKw == null ? "–" : formatKw(row.consumptionKw, 2),
                        },
                      ]
                    : []),
                  ...(series.eigenverbrauch
                    ? [
                        {
                          label: "Eigenverbrauch",
                          value:
                            row.consumedFromPvKw == null ? "–" : formatKw(row.consumedFromPvKw, 2),
                        },
                      ]
                    : []),
                  { label: "Stromkonto", value: stromkonto },
                ]}
              />
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
  series,
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
  series: ChartSeriesVisibility;
}) {
  const tickInterval = data.length > 14 ? Math.ceil(data.length / 10) - 1 : 0;
  const chartData = useMemo(
    () =>
      data.map((point) => ({
        ...point,
        stromkontoKwh: point.yieldKwh - point.consumptionKwh,
        yieldKwh: toDisplayEnergy(point.yieldKwh, unit),
        consumptionKwh: toDisplayEnergy(point.consumptionKwh, unit),
        eigenverbrauchKwh: toDisplayEnergy(point.directSolarKwh + point.batteryKwh, unit),
        eigenOnYieldKwh: toDisplayEnergy(
          Math.min(point.directSolarKwh + point.batteryKwh, point.yieldKwh),
          unit,
        ),
        yieldRestKwh: toDisplayEnergy(
          Math.max(0, point.yieldKwh - (point.directSolarKwh + point.batteryKwh)),
          unit,
        ),
      })),
    [data, unit],
  );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        margin={CHART_MARGIN}
        barGap={2}
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
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={axisTickLabel}
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
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={(props) => {
            if (!props.active || !props.payload?.length) return null;
            const row = props.payload[0]?.payload as
              | {
                  dayKey?: string;
                  yieldKwh?: number;
                  consumptionKwh?: number;
                  eigenverbrauchKwh?: number;
                  stromkontoKwh?: number;
                }
              | undefined;
            if (!row) return null;
            return (
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
                          value: formatDetailEnergy(Number(row.yieldKwh ?? 0), unit, trimDecimal),
                        },
                      ]
                    : []),
                  ...(series.verbrauch
                    ? [
                        {
                          label: "Verbrauch",
                          value: formatDetailEnergy(Number(row.consumptionKwh ?? 0), unit, trimDecimal),
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
            );
          }}
        />
        {series.ertrag && series.eigenverbrauch ? (
          <Bar
            dataKey="eigenOnYieldKwh"
            stackId="ertrag"
            fill="url(#bar-eigenverbrauch)"
            radius={[0, 0, 6, 6]}
            maxBarSize={16}
          />
        ) : null}
        {series.ertrag && series.eigenverbrauch ? (
          <Bar
            dataKey="yieldRestKwh"
            stackId="ertrag"
            fill="url(#bar-yield)"
            radius={[6, 6, 0, 0]}
            maxBarSize={16}
          />
        ) : series.ertrag ? (
          <Bar dataKey="yieldKwh" fill="url(#bar-yield)" radius={[6, 6, 6, 6]} maxBarSize={16} />
        ) : series.eigenverbrauch ? (
          <Bar
            dataKey="eigenverbrauchKwh"
            fill="url(#bar-eigenverbrauch)"
            radius={[6, 6, 6, 6]}
            maxBarSize={16}
          />
        ) : null}
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
    return `Heute, ${formatYieldKwh(yieldKwh, 1)} / ${consumption} / ${stromkonto}`;
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
    return `${label}, ${formatYieldMwh(yieldKwh, yieldDigits)} / ${formatYieldMwh(consumptionKwh, consumptionDigits)} / -`;
  }
  const stromkontoKwh = yieldKwh - consumptionKwh;
  if (range === "jahr") {
    const trim = 1;
    const yieldDigits = Math.max(0, mwhFractionDigits(yieldKwh / 1000) - trim);
    const consumptionDigits = Math.max(0, mwhFractionDigits(consumptionKwh / 1000) - trim);
    const stromkontoDigits = Math.max(0, mwhFractionDigits(Math.abs(stromkontoKwh) / 1000) - trim);
    return `${label}, ${formatYieldMwh(yieldKwh, yieldDigits)} / ${formatYieldMwh(consumptionKwh, consumptionDigits)} / ${formatSignedMwh(stromkontoKwh, stromkontoDigits)}`;
  }
  return `${label}, ${formatYieldKwh(yieldKwh, 0)} / ${formatYieldKwh(consumptionKwh, 0)} / ${formatSignedKwh(stromkontoKwh, 0)}`;
}

function RangeTotal({ text }: { text: string }) {
  const splitAt = text.indexOf(", ");
  if (splitAt === -1) return text;
  return (
    <>
      {text.slice(0, splitAt + 2)}
      <span className="text-card-foreground">{text.slice(splitAt + 2)}</span>
    </>
  );
}

function zurichDayLabel(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
  }).format(date);
}

function applyLiveToday(
  points: DailyEnergyPoint[],
  liveToday: ChartsSectionProps["liveToday"],
  isToday: (point: DailyEnergyPoint) => boolean,
): DailyEnergyPoint[] {
  if (!liveToday) return points;
  return points.map((point) =>
    isToday(point)
      ? withLiveDayTotals(point, liveToday.yieldKwh, liveToday.consumptionKwh ?? point.consumptionKwh)
      : point,
  );
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
    eigenverbrauch: true,
  });
  const range = RANGE_ORDER[page] ?? "heute";
  const pvSimulated = isPvSimulated(source);
  const hideSimulated = useSyncExternalStore(
    hideSimulatedStore.subscribe,
    hideSimulatedStore.getSnapshot,
    hideSimulatedStore.getServerSnapshot,
  );
  const hidePv = hideSimulated && pvSimulated;

  const todayChartData = useMemo((): TodayChartPoint[] => {
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    return today.map((point) => {
      const isFuture = parseTimeToMinutes(point.time) > nowMinutes;
      if (isFuture) {
        return {
          time: point.time,
          label: point.label,
          productionKw: null,
          consumptionKw: null,
          consumedFromPvKw: null,
        };
      }
      return {
        time: point.time,
        label: point.label,
        productionKw: point.productionKw,
        consumptionKw: point.consumptionKw,
        consumedFromPvKw:
          point.consumptionKw == null
            ? null
            : Math.min(point.productionKw, point.consumptionKw),
      };
    });
  }, [today]);

  const todayDayLabel = zurichDayLabel();
  const weekWithLive = useMemo(
    () => applyLiveToday(week, liveToday, (point) => point.label === "Heute"),
    [week, liveToday],
  );
  const monthWithLive = useMemo(
    () => applyLiveToday(month, liveToday, (point) => point.label === todayDayLabel),
    [month, liveToday, todayDayLabel],
  );

  const total = useMemo(
    () =>
      formatRangeTotal(
        range,
        today,
        todayChartData,
        weekWithLive,
        monthWithLive,
        year,
        lifetime,
        liveToday,
        stromkontoChangeTodayKwh,
      ),
    [range, today, todayChartData, weekWithLive, monthWithLive, year, lifetime, liveToday, stromkontoChangeTodayKwh],
  );

  const barData =
    range === "woche"
      ? weekWithLive
      : range === "monat"
        ? monthWithLive
        : range === "jahr"
          ? year
          : lifetimeWithout2021(lifetime);
  const todayEnergyMissing = range === "heute" && todayEnergyDataMissing(todayChartData, liveToday);
  const cardRef = useRef<HTMLDivElement | null>(null);

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
    <Card ref={cardRef} className="yield-chart-card shadow-card rounded-2xl">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Ertrag, Verbrauch, Stromkonto
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
        <SwipePageSurface
          labels={RANGE_LABELS}
          page={page}
          onPageChange={(next) => {
            setPage(next);
            if (next !== page) pvStore.refreshHistory();
          }}
          className="yield-chart-surface pb-1"
        >
          <div className="yield-chart-stack flex flex-col gap-3">
            <div
              className={cn(
                "yield-chart-plot h-56 min-w-0 landscape:h-64 sm:h-72 transition-opacity",
                !hidePv && pvSimulated && SIMULATED_OPACITY_CLASS,
              )}
              style={
                hidePv || todayEnergyMissing
                  ? undefined
                  : { marginLeft: -CHART_PULL_LEFT, width: `calc(100% + ${CHART_PULL_LEFT}px)` }
              }
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
                <TodayPowerChart data={todayChartData} series={series} />
              ) : (
                <YieldConsumptionChart
                  data={barData}
                  unit={range === "jahr" || range === "lebensdauer" ? "MWh" : "kWh"}
                  trimDecimal={range === "jahr"}
                  expandWeekdayLabel={range === "woche"}
                  expandMonthDayLabel={range === "monat"}
                  expandMonthNameLabel={range === "jahr"}
                  showStromkonto={range !== "lebensdauer"}
                  series={series}
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
        </SwipePageSurface>
      </CardContent>
    </Card>
  );
}
