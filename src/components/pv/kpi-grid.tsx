import { BatteryFull, Home, PiggyBank, Sun } from "lucide-react";
import { StatCard } from "@/components/pv/stat-card";
import { isGridSimulated, isPvSimulated } from "@/lib/data-fidelity";
import { formatSignedSwissNumber, formatSwissNumber } from "@/lib/format";
import type { PvSnapshot } from "@/lib/pv-data";
import type { DataSource, GridSource } from "@/lib/pv-source";

export function KpiGrid({
  snapshot,
  source,
  gridSource,
}: {
  snapshot: PvSnapshot;
  source: DataSource;
  gridSource: GridSource;
}) {
  const pvSimulated = isPvSimulated(source);
  const gridSimulated = isGridSimulated(gridSource);
  const stromkontoNegative =
    snapshot.stromkontoBalanceKwh != null && snapshot.stromkontoBalanceKwh < 0;
  const stromkontoChangeNegative =
    snapshot.stromkontoChangeTodayKwh != null && snapshot.stromkontoChangeTodayKwh < 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label="Heute erzeugt"
        value={formatSwissNumber(snapshot.todayYieldKwh, 1)}
        unit="kWh"
        icon={<Sun className="size-5" />}
        accent="green"
        simulated={pvSimulated}
      />
      <StatCard
        label="Heute verbraucht"
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
        icon={<PiggyBank className="size-5" />}
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
    </div>
  );
}
