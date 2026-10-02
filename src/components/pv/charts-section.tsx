"use client";

import { useMemo, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SIMULATED_OPACITY_CLASS, isPvSimulated } from "@/lib/data-fidelity";
import type { DailyEnergyPoint, HistoryPoint, PvSnapshot } from "@/lib/pv-data";
import type { DataSource } from "@/lib/pv-source";
import { formatKw, formatSwissNumber, formatYieldKwh } from "@/lib/format";
import { cn } from "@/lib/utils";

type ChartsSectionProps = {
  snapshot: PvSnapshot;
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
  lifetime: DailyEnergyPoint[];
  source: DataSource;
};

function sumYieldKwh(points: DailyEnergyPoint[]): number {
  return points.reduce((sum, point) => sum + point.yieldKwh, 0);
}

type Range = "heute" | "woche" | "monat" | "jahr" | "lebensdauer";

type TodayChartPoint = {
  time: string;
  label: string;
  productionKw: number | null;
  consumptionKw: number | null;
  consumedFromPvKw: number | null;
  crossLabel?: string;
  crossY?: number | null;
  crossLane?: number;
};

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutesAsTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Schnittpunkte von PV-Ausgabe und Leistungsaufnahme: Vorzeichenwechsel von
 * (Erzeugung − Verbrauch), Uhrzeit linear zwischen den Samples interpoliert.
 */
function withIntersectionLabels(data: TodayChartPoint[]): TodayChartPoint[] {
  const byIndex = new Map<number, string[]>();

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    if (prev.productionKw == null || prev.consumptionKw == null) continue;
    if (curr.productionKw == null || curr.consumptionKw == null) continue;

    const d0 = prev.productionKw - prev.consumptionKw;
    const d1 = curr.productionKw - curr.consumptionKw;
    const peak = Math.max(
      prev.productionKw,
      prev.consumptionKw,
      curr.productionKw,
      curr.consumptionKw,
    );
    if (peak < 0.05) continue;
    if (d0 === 0 || d0 * d1 >= 0) continue;

    const t = Math.abs(d0) / (Math.abs(d0) + Math.abs(d1));
    const minutes =
      parseTimeToMinutes(prev.time) + t * (parseTimeToMinutes(curr.time) - parseTimeToMinutes(prev.time));
    const index = t < 0.5 ? i - 1 : i;
    const times = byIndex.get(index) ?? [];
    times.push(formatMinutesAsTime(minutes));
    byIndex.set(index, times);
  }

  let lane = 0;
  return data.map((point, index) => {
    const times = byIndex.get(index);
    if (!times) return point;
    return {
      ...point,
      crossLabel: times[0],
      crossY: point.productionKw ?? point.consumptionKw,
      crossLane: lane++ % 2,
    };
  });
}

function IntersectionDot({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: TodayChartPoint;
}) {
  if (cx == null || cy == null || payload?.crossLabel == null) return null;
  const labelY = cy + (payload.crossLane === 1 ? 16 : -12);
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={3.5}
        fill="var(--background)"
        stroke="var(--foreground)"
        strokeWidth={1.5}
      />
      <text
        x={cx}
        y={labelY}
        textAnchor="middle"
        dominantBaseline={payload.crossLane === 1 ? "hanging" : "auto"}
        fontSize={10}
        fontWeight={600}
        fill="var(--foreground)"
      >
        {payload.crossLabel}
      </text>
    </g>
  );
}

function sampleIntervalHours(points: HistoryPoint[]): number {
  if (points.length < 2) return 1;
  const delta = parseTimeToMinutes(points[1].time) - parseTimeToMinutes(points[0].time);
  return delta > 0 ? delta / 60 : 1;
}

/**
 * Tageskurve analog FusionSolar: PV-Ausgabe als Fläche, Leistungsaufnahme
 * als orangene Linie, der Anteil „Verbraucht von PV“ als zweite Fläche.
 * Zukünftige Stunden bleiben leer (Kurve endet bei „jetzt“).
 */
function TodayPowerChart({ data }: { data: TodayChartPoint[] }) {
  const hourTicks = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"];
  const chartData = useMemo(() => withIntersectionLabels(data), [data]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 22, right: 12, left: -8, bottom: 4 }}>
        <defs>
          <linearGradient id="fill-pv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.06} />
          </linearGradient>
          <linearGradient id="fill-from-pv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
        <XAxis
          dataKey="label"
          ticks={hourTicks}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(v) => formatSwissNumber(Number(v), 1)}
          label={{
            value: "kW",
            position: "insideTopLeft",
            offset: -8,
            style: { fill: "var(--muted-foreground)", fontSize: 11 },
          }}
        />
        <Tooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.35 }}
          formatter={(value, name) => {
            if (name === "crossY") return null;
            const label =
              name === "productionKw"
                ? "PV-Ausgabe"
                : name === "consumptionKw"
                  ? "Leistungsaufnahme"
                  : "Verbraucht von PV";
            return [formatKw(Number(value), 2), label];
          }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            fontSize: 12,
            color: "var(--popover-foreground)",
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
          stroke="var(--chart-3)"
          strokeOpacity={0.55}
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
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
          connectNulls={false}
        />
        <Line
          type="linear"
          dataKey="crossY"
          name="crossY"
          stroke="none"
          legendType="none"
          tooltipType="none"
          isAnimationActive={false}
          dot={<IntersectionDot />}
          activeDot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Zwei Säulen pro Tag: links der Gesamtertrag, rechts eine gestapelte Säule,
 * die zeigt, woraus sich der Verbrauch zusammensetzt (direkt von PV oder aus
 * dem Speicher entladen). Angelehnt an die Verlaufsansicht der Huawei Solar
 * App.
 */
function YieldConsumptionChart({ data }: { data: DailyEnergyPoint[] }) {
  const tickInterval = data.length > 14 ? Math.ceil(data.length / 10) - 1 : 0;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={4}>
        <defs>
          <linearGradient id="bar-yield" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id="bar-direct" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id="bar-battery-share" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.55} />
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
          width={40}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(v) => formatSwissNumber(Number(v), 0)}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          formatter={(value, name) => {
            const label =
              name === "yieldKwh"
                ? "Ertrag"
                : name === "directSolarKwh"
                  ? "Direkt von PV"
                  : "Aus Speicher";
            return [formatYieldKwh(Number(value), 1), label];
          }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            fontSize: 12,
            color: "var(--popover-foreground)",
          }}
        />
        <Bar dataKey="yieldKwh" fill="url(#bar-yield)" radius={[6, 6, 6, 6]} maxBarSize={22} />
        <Bar
          dataKey="directSolarKwh"
          stackId="verbrauch"
          fill="url(#bar-direct)"
          radius={[0, 0, 6, 6]}
          maxBarSize={22}
        />
        <Bar
          dataKey="batteryKwh"
          stackId="verbrauch"
          fill="url(#bar-battery-share)"
          radius={[6, 6, 0, 0]}
          maxBarSize={22}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChartsSection({
  snapshot,
  today,
  week,
  month,
  year,
  lifetime,
  source,
}: ChartsSectionProps) {
  const [range, setRange] = useState<Range>("heute");
  const pvSimulated = isPvSimulated(source);

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
        consumedFromPvKw: Math.min(point.productionKw, point.consumptionKw),
      };
    });
  }, [today]);

  const total = useMemo(() => {
    if (range === "heute") {
      const hours = sampleIntervalHours(today);
      const kwh = todayChartData.reduce(
        (sum, point) => sum + (point.productionKw ?? 0) * hours,
        0,
      );
      return `${formatYieldKwh(kwh, 1)} heute`;
    }
    const points =
      range === "woche" ? week : range === "monat" ? month : range === "jahr" ? year : lifetime;
    const kwh = points.reduce((sum, p) => sum + p.yieldKwh, 0);
    return range === "lebensdauer"
      ? `${formatYieldKwh(kwh, 0)} seit Inbetriebnahme`
      : `${formatYieldKwh(kwh, 0)} im Zeitraum`;
  }, [range, today, todayChartData, week, month, year, lifetime]);

  return (
    <Card className="shadow-card rounded-2xl">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Ertrag &amp; Verbrauch
          </CardTitle>
          <span className="text-xs text-muted-foreground">{total}</span>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="heute">Heute</TabsTrigger>
            <TabsTrigger value="woche">Woche</TabsTrigger>
            <TabsTrigger value="monat">Monat</TabsTrigger>
            <TabsTrigger value="jahr">Jahr</TabsTrigger>
            <TabsTrigger value="lebensdauer">Lebensdauer</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "h-56 w-full landscape:h-64 sm:h-72 transition-opacity",
            pvSimulated && SIMULATED_OPACITY_CLASS,
          )}
        >
          {range === "heute" ? (
            <TodayPowerChart data={todayChartData} />
          ) : (
            <YieldConsumptionChart
              data={
                range === "woche"
                  ? week
                  : range === "monat"
                    ? month
                    : range === "jahr"
                      ? year
                      : lifetime
              }
            />
          )}
        </div>
        <div
          className={cn(
            "mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground transition-opacity",
            pvSimulated && SIMULATED_OPACITY_CLASS,
          )}
        >
          {range === "heute" ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-3" />
                PV-Ausgabe
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-1" />
                Leistungsaufnahme
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full border border-chart-3 bg-chart-3/40" />
                Verbraucht von PV
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-3" />
                Ertrag
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-5" />
                Direkt von PV
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-1" />
                Aus Speicher
              </span>
            </>
          )}
        </div>

        <div
          className={cn(
            "mt-4 flex flex-col gap-2.5 border-t border-border/60 pt-4 transition-opacity",
            pvSimulated && SIMULATED_OPACITY_CLASS,
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ertrag dieser Monat</span>
            <span className="text-sm font-semibold tabular-nums">
              {month.length ? formatYieldKwh(sumYieldKwh(month), 1) : "–"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ertrag dieses Jahr</span>
            <span className="text-sm font-semibold tabular-nums">
              {year.length ? formatYieldKwh(sumYieldKwh(year), 0) : "–"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ertrag seit Inbetriebnahme</span>
            <span className="text-sm font-semibold tabular-nums">
              {formatYieldKwh(snapshot.totalYieldKwh, 0)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
