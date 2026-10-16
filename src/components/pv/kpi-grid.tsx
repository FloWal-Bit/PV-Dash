import { useSyncExternalStore } from "react";
import { BatteryFull, Home, Sun } from "lucide-react";
import { StatCard } from "@/components/pv/stat-card";
import { isGridSimulated, isPvSimulated } from "@/lib/data-fidelity";
import { hideSimulatedStore } from "@/lib/hide-simulated";
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
  const hideSimulated = useSyncExternalStore(
    hideSimulatedStore.subscribe,
    hideSimulatedStore.getSnapshot,
    hideSimulatedStore.getServerSnapshot,
  );
  const hidePv = hideSimulated && pvSimulated;
  const hideGrid = hideSimulated && gridSimulated;
  const stromkontoNegative =
    snapshot.stromkontoBalanceKwh != null && snapshot.stromkontoBalanceKwh < 0;
  const stromkontoChangeNegative =
    snapshot.stromkontoChangeTodayKwh != null && snapshot.stromkontoChangeTodayKwh < 0;

  return (
    <div className={cn("grid h-full grid-cols-2 gap-3", className)}>
      <StatCard
        label={<span data-kpi-label="kpi-top">Stromkonto heute</span>}
        value={
          hideGrid || snapshot.stromkontoChangeTodayKwh == null
            ? "–"
            : formatSignedSwissNumber(snapshot.stromkontoChangeTodayKwh, 1)
        }
        unit={hideGrid || snapshot.stromkontoChangeTodayKwh == null ? undefined : "kWh"}
        icon={<BatteryFull className="size-5 -rotate-90" />}
        accent={stromkontoChangeNegative ? "rose" : "green"}
        simulated={!hideGrid && gridSimulated}
      />
      <StatCard
        label="Stand Stromkonto"
        value={
          hideGrid || snapshot.stromkontoBalanceKwh == null
            ? "–"
            : formatSwissNumber(snapshot.stromkontoBalanceKwh, 1)
        }
        unit={hideGrid || snapshot.stromkontoBalanceKwh == null ? undefined : "kWh"}
        icon={<BatteryFull className="size-5 -rotate-90" />}
        accent={stromkontoNegative ? "rose" : "green"}
        simulated={!hideGrid && gridSimulated}
      />
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
        value={hidePv ? "–" : formatSwissNumber(snapshot.todayYieldKwh, 1)}
        unit={hidePv ? undefined : "kWh"}
        icon={<Sun className="size-5" />}
        accent="green"
        simulated={!hidePv && pvSimulated}
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
          hidePv || snapshot.todayConsumptionKwh == null
            ? "–"
            : formatSwissNumber(snapshot.todayConsumptionKwh, 1)
        }
        unit={hidePv || snapshot.todayConsumptionKwh == null ? undefined : "kWh"}
        hint={snapshot.todayConsumptionKwh == null ? "keine Verbrauchsdaten verfügbar" : undefined}
        icon={<Home className="size-5" />}
        accent="rose"
        simulated={!hidePv && pvSimulated}
      />
    </div>
  );
}
