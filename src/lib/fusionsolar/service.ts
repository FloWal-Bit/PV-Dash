/**
 * Orchestriert die FusionSolar-Northbound-API-Aufrufe zu den Datenformen,
 * die das Dashboard erwartet (`PvSnapshot`, `HistoryPoint[]`,
 * `DailyEnergyPoint[]`), und cacht Ergebnisse serverseitig im Speicher.
 *
 * Das Caching ist kein "nice to have", sondern zwingend: Huawei erlaubt für
 * `getStationRealKpi` faktisch nur eine Anfrage alle ~5 Minuten pro
 * verwalteten 100 Anlagen (bei einer einzelnen Anlage also 1 Slot), und für
 * die stündlichen/täglichen/monatlichen Verlaufs-Endpunkte jeweils
 * Aufrufe/Tag = Aufrund(Anlagen/100) + 24. Ohne Cache würde ein Browser, der
 * alle 15 Sekunden pollt, das Tageslimit binnen Minuten aufbrauchen und die
 * Anlage für den Rest des Tages mit Fehlercode 407 sperren.
 */

import type { DailyEnergyPoint, HistoryPoint, PvSnapshot } from "@/lib/pv-data";
import { getFusionSolarConfig } from "./config";
import * as api from "./client";
import {
  DEV_TYPE_BATTERY,
  DEV_TYPE_GRID_METER,
  DEV_TYPE_POWER_SENSOR,
  DEV_TYPE_RESIDENTIAL_INVERTER,
  DEV_TYPE_STRING_INVERTER,
} from "./types";
import {
  buildSnapshot,
  mapBatteries,
  mapDaySeriesToMonth,
  mapDaySeriesToWeek,
  mapHourSeriesToToday,
  mapMonthSeriesToYear,
  mapStationRealKpi,
  mapYearSeriesToLifetime,
  sumInverterPower,
  sumMeterGridPower,
} from "./mapper";

export type FusionSolarDashboardData = {
  snapshot: PvSnapshot;
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
  lifetime: DailyEnergyPoint[];
};

const LIVE_TTL_MS = 6 * 60 * 1000; // real-time station/device KPIs (~1 Slot / 5 Min laut Huawei)
const HISTORY_TTL_MS = 65 * 60 * 1000; // stündliche/tägliche Verlaufsdaten (~24 Aufrufe/Tag Budget)
const DEV_LIST_TTL_MS = 6 * 60 * 60 * 1000; // Gerätezuordnung ändert sich praktisch nie
const STATION_CODE_TTL_MS = 24 * 60 * 60 * 1000;
// Jahresdaten ändern sich höchstens einmal täglich – seltener pollen, um das
// knappe Tagesbudget nicht unnötig für die "Lebensdauer"-Ansicht zu belasten.
const LIFETIME_TTL_MS = 6 * 60 * 60 * 1000;

type Cache<T> = { value: T; expiresAt: number };
let stationInfoCache: Cache<{ stationCode: string; systemPeakKwp: number }> | null = null;
let devicesCache: Cache<{
  inverterIds: number[];
  inverterTypeId: number;
  batteryIds: number[];
  meterIds: number[];
  meterTypeId: number;
}> | null = null;
let liveCache: Cache<PvSnapshot> | null = null;
let historyCache: Cache<{
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}> | null = null;
let lifetimeCache: Cache<DailyEnergyPoint[]> | null = null;

// Deduplicate concurrent in-flight fetches of the same resource (e.g. two
// browser tabs polling at the same moment) so we never double-spend our
// rate-limit budget on a cache miss.
let liveInFlight: Promise<PvSnapshot> | null = null;
let historyInFlight: Promise<{
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}> | null = null;
let lifetimeInFlight: Promise<DailyEnergyPoint[]> | null = null;

function fresh<T>(cache: Cache<T> | null): cache is Cache<T> {
  return cache != null && cache.expiresAt > Date.now();
}

async function resolveStationInfo(): Promise<{ stationCode: string; systemPeakKwp: number }> {
  if (fresh(stationInfoCache)) return stationInfoCache.value;

  const config = getFusionSolarConfig();
  if (!config) throw new Error("FusionSolar nicht konfiguriert.");

  const stations = await api.listStations();
  const match = config.stationCode
    ? stations.find((s) => s.plantCode === config.stationCode)
    : stations[0];

  if (!match) {
    if (config.stationCode) {
      throw new Error(
        `FUSIONSOLAR_STATION_CODE "${config.stationCode}" wurde im Konto nicht gefunden.`,
      );
    }
    throw new Error("FusionSolar-Konto hat keine Anlagen (Plants) hinterlegt.");
  }

  const value = { stationCode: match.plantCode, systemPeakKwp: match.capacity ?? 0 };
  stationInfoCache = { value, expiresAt: Date.now() + STATION_CODE_TTL_MS };
  return value;
}

async function resolveDevices(stationCode: string) {
  if (fresh(devicesCache)) return devicesCache.value;

  const devices = await api.getDevList([stationCode]);
  const inverters = devices.filter(
    (d) => d.devTypeId === DEV_TYPE_STRING_INVERTER || d.devTypeId === DEV_TYPE_RESIDENTIAL_INVERTER,
  );
  const batteries = devices.filter((d) => d.devTypeId === DEV_TYPE_BATTERY);
  const meters = devices.filter(
    (d) => d.devTypeId === DEV_TYPE_GRID_METER || d.devTypeId === DEV_TYPE_POWER_SENSOR,
  );

  const value = {
    inverterIds: inverters.map((d) => d.id),
    inverterTypeId: inverters[0]?.devTypeId ?? DEV_TYPE_STRING_INVERTER,
    batteryIds: batteries.map((d) => d.id),
    meterIds: meters.map((d) => d.id),
    meterTypeId: meters[0]?.devTypeId ?? DEV_TYPE_GRID_METER,
  };
  devicesCache = { value, expiresAt: Date.now() + DEV_LIST_TTL_MS };
  return value;
}

async function fetchLiveSnapshot(): Promise<PvSnapshot> {
  const { stationCode, systemPeakKwp } = await resolveStationInfo();
  const devices = await resolveDevices(stationCode);

  const [realKpi, inverterKpi, batteryKpi, meterKpi] = await Promise.all([
    api.getStationRealKpi([stationCode]),
    devices.inverterIds.length
      ? api.getInverterRealKpi(devices.inverterTypeId, devices.inverterIds)
      : Promise.resolve([]),
    devices.batteryIds.length ? api.getBatteryRealKpi(devices.batteryIds) : Promise.resolve([]),
    devices.meterIds.length
      ? api.getMeterRealKpi(devices.meterTypeId, devices.meterIds)
      : Promise.resolve([]),
  ]);

  const overview = mapStationRealKpi(realKpi[0]);
  const productionKw = sumInverterPower(inverterKpi);
  const battery = mapBatteries(batteryKpi);
  const gridKw = sumMeterGridPower(meterKpi);

  return buildSnapshot({
    timestamp: Date.now(),
    productionKw,
    gridKw,
    battery,
    overview,
    systemPeakKwp,
  });
}

async function fetchHistory(): Promise<{
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}> {
  const { stationCode } = await resolveStationInfo();
  const devices = await resolveDevices(stationCode);
  const hasBattery = devices.batteryIds.length > 0;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

  const [hourSeries, monthDays, prevMonthDays, yearMonths] = await Promise.all([
    api.getStationHourKpi([stationCode], startOfDay),
    api.getStationDayKpi([stationCode], startOfMonth),
    // Only needed to backfill "last 7 days" near the start of a month.
    now.getDate() < 7
      ? api.getStationDayKpi([stationCode], startOfPrevMonth)
      : Promise.resolve([]),
    api.getStationMonthKpi([stationCode], startOfYear).catch((err) => {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      console.error("[fusionsolar] Monatsdaten (Jahr) nicht verfügbar:", message);
      return [] as Awaited<ReturnType<typeof api.getStationMonthKpi>>;
    }),
  ]);

  const combinedDays = [...prevMonthDays, ...monthDays];

  return {
    today: mapHourSeriesToToday(hourSeries),
    week: mapDaySeriesToWeek(combinedDays, hasBattery),
    month: mapDaySeriesToMonth(monthDays, hasBattery),
    year: mapMonthSeriesToYear(yearMonths, hasBattery),
  };
}

async function fetchLifetime(): Promise<DailyEnergyPoint[]> {
  const { stationCode } = await resolveStationInfo();
  const devices = await resolveDevices(stationCode);
  try {
    const yearSeries = await api.getStationYearKpi([stationCode], Date.now());
    return mapYearSeriesToLifetime(yearSeries, devices.batteryIds.length > 0);
  } catch (err) {
    // Manche FusionSolar-Konten haben keine Berechtigung für
    // getKpiStationYear – die "Lebensdauer"-Ansicht ist dann leer statt den
    // gesamten Dashboard-Abruf scheitern zu lassen.
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    console.error("[fusionsolar] Jahresdaten (Lebensdauer) nicht verfügbar:", message);
    return [];
  }
}

export async function getFusionSolarLiveSnapshot(): Promise<PvSnapshot> {
  if (fresh(liveCache)) return liveCache.value;
  if (!liveInFlight) {
    liveInFlight = fetchLiveSnapshot().finally(() => {
      liveInFlight = null;
    });
  }
  const snapshot = await liveInFlight;
  liveCache = { value: snapshot, expiresAt: Date.now() + LIVE_TTL_MS };
  return snapshot;
}

export async function getFusionSolarHistory(): Promise<{
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}> {
  if (fresh(historyCache)) return historyCache.value;
  if (!historyInFlight) {
    historyInFlight = fetchHistory().finally(() => {
      historyInFlight = null;
    });
  }
  const history = await historyInFlight;
  historyCache = { value: history, expiresAt: Date.now() + HISTORY_TTL_MS };
  return history;
}

export async function getFusionSolarLifetimeHistory(): Promise<DailyEnergyPoint[]> {
  if (fresh(lifetimeCache)) return lifetimeCache.value;
  if (!lifetimeInFlight) {
    lifetimeInFlight = fetchLifetime().finally(() => {
      lifetimeInFlight = null;
    });
  }
  const lifetime = await lifetimeInFlight;
  lifetimeCache = { value: lifetime, expiresAt: Date.now() + LIFETIME_TTL_MS };
  return lifetime;
}

export async function getFusionSolarDashboardData(): Promise<FusionSolarDashboardData> {
  const [snapshot, history, lifetime] = await Promise.all([
    getFusionSolarLiveSnapshot(),
    getFusionSolarHistory(),
    getFusionSolarLifetimeHistory(),
  ]);
  return { snapshot, ...history, lifetime };
}
