"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
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
/** Einheit über der Y-Skala, rechtsbündig mit den Zahlen. */
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
      x={viewBox.x + viewBox.width}
      y={viewBox.y - 14}
      textAnchor="end"
      fill="var(--muted-foreground)"
      fontSize={11}
    >
      {value}
    </text>
  );
}

/** Volle und halbe Stunde. Beschriftet wird jede zweite Stunde, sonst überlagern sich die Zeiten auf dem Handy. */
function halfHourTicks(): string[] {
  const ticks: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const hh = String(hour).padStart(2, "0");
    ticks.push(`${hh}:00`, `${hh}:30`);
  }
  return ticks;
}

function TodayAxisTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const value = String(payload?.value ?? "");
  const [hour = "00", minute = "00"] = value.split(":");
  const halfHour = minute === "30";
  const showLabel = !halfHour && Number(hour) % 2 === 0;
  return (
    <g transform={`translate(${x},${y})`}>
      <line
        y2={halfHour ? 4 : 6}
        stroke="var(--muted-foreground)"
        strokeOpacity={halfHour ? 0.55 : 0.85}
      />
      {showLabel ? (
        <text y={14} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10}>
          {hour}
        </text>
      ) : null}
    </g>
  );
}

function TodayPowerChart({ data }: { data: TodayChartPoint[] }) {
  const hourTicks = halfHourTicks().filter((tick) => data.some((point) => point.label === tick));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 28, right: 12, left: -8, bottom: 4 }}>
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
          tickLine={false}
          axisLine={false}
          tick={TodayAxisTick}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(v) => formatSwissNumber(Number(v), 1)}
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
                  {
                    label: "Ertrag",
                    value: row.productionKw == null ? "–" : formatKw(row.productionKw, 2),
                  },
                  {
                    label: "Verbrauch",
                    value: row.consumptionKw == null ? "–" : formatKw(row.consumptionKw, 2),
                  },
                  {
                    label: "Eigenverbrauch",
                    value: row.consumedFromPvKw == null ? "–" : formatKw(row.consumedFromPvKw, 2),
                  },
                  { label: "Stromkonto", value: stromkonto },
                ]}
              />
            );
          }}
        />
        <Area
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
        <Area
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
        <Line
          type="linear"
          dataKey="consumptionKw"
          name="consumptionKw"
          stroke="var(--chart-5)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
          connectNulls={false}
        />
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

/** Drei Säulen pro Tag: Ertrag, Verbrauch, Eigenverbrauch (PV + Speicheranteil). */
function YieldConsumptionChart({
  data,
  unit = "kWh",
  trimDecimal = false,
  expandWeekdayLabel = false,
  expandMonthDayLabel = false,
  expandMonthNameLabel = false,
  showStromkonto = true,
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
      })),
    [data, unit],
  );
  const maxValue = chartData.reduce(
    (max, point) => Math.max(max, point.yieldKwh, point.consumptionKwh, point.eigenverbrauchKwh),
    0,
  );
  const fractionDigits =
    unit === "MWh" ? Math.max(0, mwhFractionDigits(maxValue) - (trimDecimal ? 1 : 0)) : 0;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        margin={{ top: 28, right: 8, left: -16, bottom: 0 }}
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
          interval={tickInterval}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={unit === "MWh" ? 48 : 40}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(v) => formatSwissNumber(Number(v), fractionDigits)}
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
                  {
                    label: "Ertrag",
                    value: formatDetailEnergy(Number(row.yieldKwh ?? 0), unit, trimDecimal),
                  },
                  {
                    label: "Verbrauch",
                    value: formatDetailEnergy(Number(row.consumptionKwh ?? 0), unit, trimDecimal),
                  },
                  {
                    label: "Eigenverbrauch",
                    value: formatDetailEnergy(Number(row.eigenverbrauchKwh ?? 0), unit, trimDecimal),
                  },
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
        <Bar dataKey="yieldKwh" fill="url(#bar-yield)" radius={[6, 6, 6, 6]} maxBarSize={16} />
        <Bar
          dataKey="consumptionKwh"
          fill="url(#bar-consumption)"
          radius={[6, 6, 6, 6]}
          maxBarSize={16}
        />
        <Bar
          dataKey="eigenverbrauchKwh"
          fill="url(#bar-eigenverbrauch)"
          radius={[6, 6, 6, 6]}
          maxBarSize={16}
        />
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
    woche: "Diese Woche",
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

  return (
    <Card className="shadow-card rounded-2xl">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Ertrag, Verbrauch, Stromkonto
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {hidePv ? "Simulierte Verläufe sind ausgeblendet" : total}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <SwipePageSurface
          labels={RANGE_LABELS}
          page={page}
          onPageChange={(next) => {
            setPage(next);
            if (next !== page) pvStore.refreshHistory();
          }}
          className="pb-1"
        >
          <div className="flex flex-col gap-3">
            <div
              className={cn(
                "h-56 min-w-0 landscape:h-64 sm:h-72 transition-opacity",
                !hidePv && pvSimulated && SIMULATED_OPACITY_CLASS,
              )}
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
                <TodayPowerChart data={todayChartData} />
              ) : (
                <YieldConsumptionChart
                  data={barData}
                  unit={range === "jahr" || range === "lebensdauer" ? "MWh" : "kWh"}
                  trimDecimal={range === "jahr"}
                  expandWeekdayLabel={range === "woche"}
                  expandMonthDayLabel={range === "monat"}
                  expandMonthNameLabel={range === "jahr"}
                  showStromkonto={range !== "lebensdauer"}
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
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-3" />
                Ertrag
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-5" />
                Verbrauch
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-eigenverbrauch" />
                Eigenverbrauch
              </span>
            </div>
          </div>
        </SwipePageSurface>
      </CardContent>
    </Card>
  );
}
