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
 * getKpiStationHour/Day/Month geben Energie pro Intervall zurück, ohne dass
 * Huawei die Einheit dokumentiert. Community-Implementierungen (und die
 * Größenordnung der Beispielwerte) legen Wh nahe – daher die Umrechnung.
 * Bitte nach dem ersten Live-Abruf mit echten Zugangsdaten verifizieren.
 */
const WATT_HOURS_TO_KWH = 1 / 1000;

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

export function mapHourSeriesToToday(items: StationKpiTimeseriesItem[]): HistoryPoint[] {
  return [...items]
    .sort((a, b) => a.collectTime - b.collectTime)
    .map((item) => {
      const date = new Date(item.collectTime);
      const label = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      const production = num(item.dataItemMap.inverter_power);
      const consumption = num(item.dataItemMap.use_power);
      return {
        time: label,
        label,
        productionKw: production != null ? round(production * WATT_HOURS_TO_KWH) : 0,
        consumptionKw: consumption != null ? round(consumption * WATT_HOURS_TO_KWH) : 0,
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
  const today = new Date();
  return [...items]
    .sort((a, b) => a.collectTime - b.collectTime)
    .slice(-7)
    .map((item) => {
      const date = new Date(item.collectTime);
      const isToday = date.toDateString() === today.toDateString();
      const yieldKwh = num(item.dataItemMap.inverter_power);
      const consumptionKwh = num(item.dataItemMap.use_power);
      const yieldKwhRounded = yieldKwh != null ? round(yieldKwh * WATT_HOURS_TO_KWH) : 0;
      const consumptionKwhRounded = consumptionKwh != null ? round(consumptionKwh * WATT_HOURS_TO_KWH) : 0;
      const { directSolarKwh, batteryKwh } = splitConsumptionApprox(
        yieldKwhRounded,
        consumptionKwhRounded,
        hasBattery,
      );
      return {
        // Der aktuelle Tag heißt "Heute" statt des Wochentagskürzels, analog
        // zur Verlaufsansicht in gängigen PV-Monitoring-Apps.
        label: isToday ? "Heute" : WEEKDAYS_DE[date.getDay()],
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
      const date = new Date(item.collectTime);
      const yieldKwh = num(item.dataItemMap.inverter_power);
      const consumptionKwh = num(item.dataItemMap.use_power);
      const yieldKwhRounded = yieldKwh != null ? round(yieldKwh * WATT_HOURS_TO_KWH) : 0;
      const consumptionKwhRounded = consumptionKwh != null ? round(consumptionKwh * WATT_HOURS_TO_KWH) : 0;
      const { directSolarKwh, batteryKwh } = splitConsumptionApprox(
        yieldKwhRounded,
        consumptionKwhRounded,
        hasBattery,
      );
      return {
        label: String(date.getDate()),
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
  const now = new Date();
  return [...items]
    .sort((a, b) => a.collectTime - b.collectTime)
    .map((item) => {
      const date = new Date(item.collectTime);
      const yieldKwh = num(item.dataItemMap.inverter_power);
      const consumptionKwh = num(item.dataItemMap.use_power);
      const yieldKwhRounded = yieldKwh != null ? round(yieldKwh * WATT_HOURS_TO_KWH) : 0;
      const consumptionKwhRounded = consumptionKwh != null ? round(consumptionKwh * WATT_HOURS_TO_KWH) : 0;
      const { directSolarKwh, batteryKwh } = splitConsumptionApprox(
        yieldKwhRounded,
        consumptionKwhRounded,
        hasBattery,
      );
      const isCurrentMonth =
        date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      return {
        label: isCurrentMonth ? "Dieser Monat" : MONTHS_DE[date.getMonth()],
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
      const date = new Date(item.collectTime);
      const yieldKwh = num(item.dataItemMap.inverter_power);
      const consumptionKwh = num(item.dataItemMap.use_power);
      const yieldKwhRounded = yieldKwh != null ? round(yieldKwh * WATT_HOURS_TO_KWH) : 0;
      const consumptionKwhRounded = consumptionKwh != null ? round(consumptionKwh * WATT_HOURS_TO_KWH) : 0;
      const { directSolarKwh, batteryKwh } = splitConsumptionApprox(
        yieldKwhRounded,
        consumptionKwhRounded,
        hasBattery,
      );
      return {
        label: String(date.getFullYear()),
        yieldKwh: yieldKwhRounded,
        consumptionKwh: consumptionKwhRounded,
        directSolarKwh,
        batteryKwh,
      };
    });
}
