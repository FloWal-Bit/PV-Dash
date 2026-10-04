import { BatteryFull, Gauge, Home, Sun } from "lucide-react";
import { StatCard } from "@/components/pv/stat-card";
import { financialAutarkyRate } from "@/lib/autarky";
import { isGridSimulated, isPvSimulated } from "@/lib/data-fidelity";
import { formatSignedSwissNumber, formatSwissNumber } from "@/lib/format";
import type { PvSnapshot } from "@/lib/pv-data";
import type { DataSource, GridSource } from "@/lib/pv-source";
import { cn } from "@/lib/utils";

export function KpiGrid({
  snapshot,
  source,
  gridSource,
  className,
}: {
  snapshot: PvSnapshot;
  source: DataSource;
  gridSource: GridSource;
  className?: string;
}) {
  const pvSimulated = isPvSimulated(source);
  const gridSimulated = isGridSimulated(gridSource);
  const stromkontoNegative =
    snapshot.stromkontoBalanceKwh != null && snapshot.stromkontoBalanceKwh < 0;
  const stromkontoChangeNegative =
    snapshot.stromkontoChangeTodayKwh != null && snapshot.stromkontoChangeTodayKwh < 0;
  const financialAutarky = financialAutarkyRate(snapshot);

  return (
    <div className={cn("grid h-full grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      <StatCard
        label={
          <>
            <span className="sm:hidden">
              Ertrag
              <br />
              heute
            </span>
            <span className="hidden sm:inline">Ertrag heute</span>
          </>
        }
        value={formatSwissNumber(snapshot.todayYieldKwh, 1)}
        unit="kWh"
        icon={<Sun className="size-5" />}
        accent="green"
        simulated={pvSimulated}
      />
      <StatCard
        label={
          <>
            <span className="sm:hidden">
              Verbrauch
              <br />
              heute
            </span>
            <span className="hidden sm:inline">Verbrauch heute</span>
          </>
        }
        value={
          snapshot.todayConsumptionKwh != null
            ? formatSwissNumber(snapshot.todayConsumptionKwh, 1)
            : "–"
        }
        unit={snapshot.todayConsumptionKwh != null ? "kWh" : undefined}
        hint={snapshot.todayConsumptionKwh == null ? "keine Verbrauchsdaten verfügbar" : undefined}
        icon={<Home className="size-5" />}
        accent="rose"
        simulated={pvSimulated}
      />
      <StatCard
        label="Stromkonto heute"
        value={
          snapshot.stromkontoChangeTodayKwh != null
            ? formatSignedSwissNumber(snapshot.stromkontoChangeTodayKwh, 1)
            : "–"
        }
        unit={snapshot.stromkontoChangeTodayKwh != null ? "kWh" : undefined}
        icon={<BatteryFull className="size-5 -rotate-90" />}
        accent={stromkontoChangeNegative ? "rose" : "green"}
        simulated={gridSimulated}
      />
      <StatCard
        label="Stand Stromkonto"
        value={
          snapshot.stromkontoBalanceKwh != null
            ? formatSwissNumber(snapshot.stromkontoBalanceKwh, 1)
            : "–"
        }
        unit={snapshot.stromkontoBalanceKwh != null ? "kWh" : undefined}
        icon={<BatteryFull className="size-5 -rotate-90" />}
        accent={stromkontoNegative ? "rose" : "green"}
        simulated={gridSimulated}
      />
      <StatCard
        label={
          <>
            <span className="md:hidden">
              Physischer Autarkiegrad
              <br />
              heute
            </span>
            <span className="hidden md:inline">Physischer Autarkiegrad heute</span>
          </>
        }
        value={snapshot.autarkyRate != null ? String(snapshot.autarkyRate) : "–"}
        unit={snapshot.autarkyRate != null ? "%" : undefined}
        icon={<Gauge className="size-5" />}
        accent="green"
        simulated={pvSimulated}
      />
      <StatCard
        label={
          <>
            <span className="md:hidden">
              Finanzieller Autarkiegrad
              <br />
              heute
            </span>
            <span className="hidden md:inline">Finanzieller Autarkiegrad heute</span>
          </>
        }
        value={financialAutarky != null ? String(financialAutarky) : "–"}
        unit={financialAutarky != null ? "%" : undefined}
        icon={<Gauge className="size-5" />}
        accent="green"
        simulated={pvSimulated}
      />
    </div>
  );
}
