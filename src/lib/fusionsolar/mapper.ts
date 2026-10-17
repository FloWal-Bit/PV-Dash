import type { DailyEnergyPoint, HistoryPoint, PvSnapshot } from "@/lib/pv-data";
import type {
  BatteryRealKpiItem,
  InverterRealKpiItem,
  MeterRealKpiItem,
  StationKpiTimeseriesItem,
  StationRealKpiItem,
} from "./types";

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * getKpiStationHour/Day/Month/Year dieser Anlage liefern die Energiemengen
 * bereits in kWh (ein Stundenwert von 6,23 ist eine Stunde Ertrag, nicht Wh).
 */

export type StationOverview = {
  todayYieldKwh: number;
  totalYieldKwh: number;
  healthState: PvSnapshot["healthState"];
  /** Netzeinspeisung heute in kWh, falls von der Anlage gemeldet. */
  dayOnGridEnergyKwh: number | null;
  /** Verbrauch heute in kWh, falls von der Anlage gemeldet. */
  dayUseEnergyKwh: number | null;
};

export function mapStationRealKpi(item: StationRealKpiItem | undefined): StationOverview {
  const map = item?.dataItemMap ?? {};
  const healthCode = map.real_health_state;
  const healthState: PvSnapshot["healthState"] =
    healthCode === "3" ? "online" : healthCode === "2" ? "fault" : healthCode === "1" ? "offline" : null;

  return {
    todayYieldKwh: num(map.day_power) ?? 0,
    totalYieldKwh: num(map.total_power) ?? 0,
    healthState,
    dayOnGridEnergyKwh: num(map.day_on_grid_energy),
    dayUseEnergyKwh: num(map.day_use_energy),
  };
}

/** Summiert die Momentanleistung aller Wechselrichter (kW). */
export function sumInverterPower(items: InverterRealKpiItem[]): number {
  return round(
    items.reduce((sum, item) => sum + (num(item.dataItemMap.active_power) ?? 0), 0),
  );
}

export type BatteryOverview = { batterySoc: number | null; batteryKw: number | null };

/** Mittelt den Ladezustand und summiert die Lade-/Entladeleistung über alle Batteriegeräte. */
export function mapBatteries(items: BatteryRealKpiItem[]): BatteryOverview {
  if (items.length === 0) return { batterySoc: null, batteryKw: null };
  const socValues = items.map((i) => num(i.dataItemMap.battery_soc)).filter((v): v is number => v != null);
  const powerValues = items
    .map((i) => num(i.dataItemMap.ch_discharge_power))
    .filter((v): v is number => v != null);

  return {
    batterySoc: socValues.length ? Math.round(socValues.reduce((a, b) => a + b, 0) / socValues.length) : null,
    batteryKw: powerValues.length ? round(powerValues.reduce((a, b) => a + b, 0) / 1000) : null,
  };
}

/**
 * Momentane Netzleistung aus einem Netz-/Leistungszähler (devTypeId 17/47),
 * sofern die Anlage einen solchen registriert hat. Positiv = Netzbezug,
 * negativ = Einspeisung (gleiche Konvention wie im Rest der App). Das
 * Vorzeichen ist nicht in der Huawei-Doku spezifiziert und sollte nach dem
 * ersten Live-Test verifiziert werden.
 */
export function sumMeterGridPower(items: MeterRealKpiItem[]): number | null {
  if (items.length === 0) return null;
  return round(items.reduce((sum, item) => sum + (num(item.dataItemMap.active_power) ?? 0), 0));
}

export function buildSnapshot(input: {
  timestamp: number;
  productionKw: number;
  gridKw: number | null;
  battery: BatteryOverview;
  overview: StationOverview;
  systemPeakKwp: number;
}): PvSnapshot {
  const { timestamp, productionKw, gridKw, battery, overview, systemPeakKwp } = input;
  const consumptionKw = gridKw != null ? round(productionKw + gridKw) : null;

  const selfConsumptionRate =
    consumptionKw != null && productionKw > 0.05
      ? Math.round((Math.min(productionKw, consumptionKw) / productionKw) * 100)
      : null;
  const autarkyRate =
    consumptionKw != null && consumptionKw > 0.05
      ? Math.round((Math.min(productionKw, consumptionKw) / consumptionKw) * 100)
      : null;

  // Der Netzbezug wird von FusionSolar nicht direkt als Tageswert geliefert.
  // Energiebilanz: Verbrauch = Eigenverbrauch + Netzbezug, Erzeugung =
  // Eigenverbrauch + Einspeisung -> Netzbezug = Verbrauch - (Erzeugung - Einspeisung).
  const gridImportTodayKwh =
    overview.dayUseEnergyKwh != null && overview.dayOnGridEnergyKwh != null
      ? round(Math.max(0, overview.dayUseEnergyKwh - (overview.todayYieldKwh - overview.dayOnGridEnergyKwh)))
      : null;

  return {
    timestamp,
    productionKw: round(productionKw),
    consumptionKw,
    gridKw,
    batterySoc: battery.batterySoc,
    batteryKw: battery.batteryKw,
    todayYieldKwh: round(overview.todayYieldKwh),
    todayConsumptionKwh: overview.dayUseEnergyKwh != null ? round(overview.dayUseEnergyKwh) : null,
    totalYieldKwh: round(overview.totalYieldKwh),
    gridFeedInTodayKwh: overview.dayOnGridEnergyKwh != null ? round(overview.dayOnGridEnergyKwh) : null,
    gridImportTodayKwh,
    stromkontoBalanceKwh: null,
    stromkontoChangeTodayKwh: null,
    selfConsumptionRate,
    autarkyRate,
    systemPeakKwp,
    weather: "sonnig",
    healthState: overview.healthState,
  };
}

const ZURICH = "Europe/Zurich";

function zurichParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZURICH,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: value("hour"),
    minute: value("minute"),
    weekday: value("weekday"),
  };
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function stationYieldKwh(map: StationKpiTimeseriesItem["dataItemMap"]): number {
  return round(num(map.inverter_power) ?? 0);
}

function stationConsumptionKwh(map: StationKpiTimeseriesItem["dataItemMap"]): number {
  return round(num(map.use_power) ?? num(map.selfProvide) ?? 0);
}

/**
 * Stundenreihe: Haushaltsverbrauch, sonst der Eigenverbrauch aus derselben
 * Antwort. Ein fehlendes Feld bleibt leer, eine gemeldete 0 bleibt 0.
 */
function stationHourConsumptionKwh(map: StationKpiTimeseriesItem["dataItemMap"]): number | null {
  const use = num(map.use_power);
  if (use != null) return round(use);
  const self = num(map.selfProvide);
  return self == null ? null : round(self);
}

export function mapHourSeriesToToday(items: StationKpiTimeseriesItem[]): HistoryPoint[] {
  return [...items]
    .sort((a, b) => a.collectTime - b.collectTime)
    .map((item) => {
      const parts = zurichParts(item.collectTime);
      const label = `${parts.hour}:${parts.minute}`;
      return {
        time: label,
        label,
        productionKw: stationYieldKwh(item.dataItemMap),
        consumptionKw: stationHourConsumptionKwh(item.dataItemMap),
      };
    });
}

const WEEKDAYS_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/**
 * FusionSolars Tages-/Monats-Zeitreihen (`getKpiStationDay`/`getKpiStationMonth`)
 * liefern nur Gesamterzeugung und Gesamtverbrauch pro Tag, keine
 * Aufschlüsselung nach Verbrauchsquelle. Für die "Direkt von PV"/"Aus
 * Speicher"-Aufteilung im Verlaufs-Chart wird daher eine grobe Näherung
 * verwendet: ohne Speicher ist der gesamte überschneidende Anteil
 * definitionsgemäß Direktverbrauch, mit Speicher wird ein Teil davon der
 * Batterie zugeschrieben. Sollte FusionSolar künftig echte Tages-Speicher-
 * werte liefern, kann diese Näherung ersetzt werden.
 */
const HISTORY_DIRECT_OVERLAP = 0.65;
const HISTORY_BATTERY_SHARE_OF_REST = 0.4;

/** Tagesbalken „Heute“ an den Live-Zähler hängen, ohne die langsame Tagesreihe neu abzufragen. */
export function withLiveDayTotals(
  point: DailyEnergyPoint,
  yieldKwh: number,
  consumptionKwh: number,
): DailyEnergyPoint {
  const directSolarKwh = Math.min(yieldKwh, consumptionKwh) * HISTORY_DIRECT_OVERLAP;
  const batteryKwh =
    point.batteryKwh > 0
      ? Math.max(0, consumptionKwh - directSolarKwh) * HISTORY_BATTERY_SHARE_OF_REST
      : 0;
  return {
    ...point,
    yieldKwh: round(yieldKwh),
    consumptionKwh: round(consumptionKwh),
    directSolarKwh: round(directSolarKwh),
    batteryKwh: round(batteryKwh),
  };
}

function splitConsumptionApprox(
  yieldKwh: number,
  consumptionKwh: number,
  hasBattery: boolean,
): { directSolarKwh: number; batteryKwh: number } {
  const directSolarKwh = Math.min(yieldKwh, consumptionKwh) * HISTORY_DIRECT_OVERLAP;
  if (!hasBattery) {
    return { directSolarKwh: round(directSolarKwh), batteryKwh: 0 };
  }
  const remaining = Math.max(0, consumptionKwh - directSolarKwh);
  const batteryKwh = remaining * HISTORY_BATTERY_SHARE_OF_REST;
  return { directSolarKwh: round(directSolarKwh), batteryKwh: round(batteryKwh) };
}

export function mapDaySeriesToWeek(
  items: StationKpiTimeseriesItem[],
  hasBattery: boolean,
): DailyEnergyPoint[] {
  const now = zurichParts(Date.now());
  return [...items]
    .sort((a, b) => a.collectTime - b.collectTime)
    .slice(-7)
    .map((item) => {
      const parts = zurichParts(item.collectTime);
      const isToday = now.day === parts.day && now.month === parts.month && now.year === parts.year;
      const yieldKwhRounded = stationYieldKwh(item.dataItemMap);
      const consumptionKwhRounded = stationConsumptionKwh(item.dataItemMap);
      const { directSolarKwh, batteryKwh } = splitConsumptionApprox(
        yieldKwhRounded,
        consumptionKwhRounded,
        hasBattery,
      );
      return {
        // Der aktuelle Tag heißt "Heute" statt des Wochentagskürzels, analog
        // zur Verlaufsansicht in gängigen PV-Monitoring-Apps.
        label: isToday ? "Heute" : WEEKDAYS_DE[WEEKDAY_INDEX[parts.weekday] ?? 0],
        yieldKwh: yieldKwhRounded,
        consumptionKwh: consumptionKwhRounded,
        directSolarKwh,
        batteryKwh,
      };
    });
}

export function mapDaySeriesToMonth(
  items: StationKpiTimeseriesItem[],
  hasBattery: boolean,
): DailyEnergyPoint[] {
  return [...items]
    .sort((a, b) => a.collectTime - b.collectTime)
    .map((item) => {
      const parts = zurichParts(item.collectTime);
      const yieldKwhRounded = stationYieldKwh(item.dataItemMap);
      const consumptionKwhRounded = stationConsumptionKwh(item.dataItemMap);
      const { directSolarKwh, batteryKwh } = splitConsumptionApprox(
        yieldKwhRounded,
        consumptionKwhRounded,
        hasBattery,
      );
      return {
        label: String(parts.day),
        yieldKwh: yieldKwhRounded,
        consumptionKwh: consumptionKwhRounded,
        directSolarKwh,
        batteryKwh,
      };
    });
}

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/**
 * getKpiStationMonth liefert einen Eintrag pro Kalendermonat des Jahres
 * um `collectTime` – für die "Jahr"-Ansicht im Verlaufs-Chart.
 */
export function mapMonthSeriesToYear(
  items: StationKpiTimeseriesItem[],
  hasBattery: boolean,
): DailyEnergyPoint[] {
  const now = zurichParts(Date.now());
  return [...items]
    .sort((a, b) => a.collectTime - b.collectTime)
    .map((item) => {
      const parts = zurichParts(item.collectTime);
      const yieldKwhRounded = stationYieldKwh(item.dataItemMap);
      const consumptionKwhRounded = stationConsumptionKwh(item.dataItemMap);
      const { directSolarKwh, batteryKwh } = splitConsumptionApprox(
        yieldKwhRounded,
        consumptionKwhRounded,
        hasBattery,
      );
      const isCurrentMonth = parts.year === now.year && parts.month === now.month;
      return {
        label: isCurrentMonth ? "Dieser Monat" : MONTHS_DE[parts.month - 1],
        yieldKwh: yieldKwhRounded,
        consumptionKwh: consumptionKwhRounded,
        directSolarKwh,
        batteryKwh,
      };
    });
}

/**
 * getKpiStationYear liefert einen Eintrag pro Kalenderjahr seit
 * Inbetriebnahme der Anlage (inkl. laufendem, ggf. unvollständigem Jahr) –
 * ideal für die "Lebensdauer"-Ansicht im Verlaufs-Chart.
 */
export function mapYearSeriesToLifetime(
  items: StationKpiTimeseriesItem[],
  hasBattery: boolean,
): DailyEnergyPoint[] {
  return [...items]
    .sort((a, b) => a.collectTime - b.collectTime)
    .map((item) => {
      const parts = zurichParts(item.collectTime);
      const yieldKwhRounded = stationYieldKwh(item.dataItemMap);
      const consumptionKwhRounded = stationConsumptionKwh(item.dataItemMap);
      const { directSolarKwh, batteryKwh } = splitConsumptionApprox(
        yieldKwhRounded,
        consumptionKwhRounded,
        hasBattery,
      );
      return {
        label: String(parts.year),
        yieldKwh: yieldKwhRounded,
        consumptionKwh: consumptionKwhRounded,
        directSolarKwh,
        batteryKwh,
      };
    });
}
