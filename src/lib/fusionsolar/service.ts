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
 * Anlage für den Rest des Tages mit Fehlercode 407 sperren. Live-KPIs werden
 * höchstens alle 6 Minuten geholt. Die heutige Stundenreihe einmal pro Stunde,
 * Woche, Monat, Jahr und Laufzeit zweimal täglich. Ein Fehlversuch wartet
 * genauso lange wie der nächste planmässige Abruf.
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
const TODAY_HISTORY_TTL_MS = 60 * 60 * 1000; // Stundenreihe einmal pro Stunde
const SLOW_HISTORY_TTL_MS = 12 * 60 * 60 * 1000; // Woche/Monat/Jahr/Laufzeit, zweimal täglich
const DEV_LIST_TTL_MS = 6 * 60 * 60 * 1000; // Gerätezuordnung ändert sich praktisch nie
const STATION_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const LIFETIME_TTL_MS = SLOW_HISTORY_TTL_MS;

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
let todayHistoryCache: Cache<HistoryPoint[]> | null = null;
let rangeHistoryCache: Cache<{
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}> | null = null;
let lifetimeCache: Cache<DailyEnergyPoint[]> | null = null;

// Deduplicate concurrent in-flight fetches of the same resource (e.g. two
// browser tabs polling at the same moment) so we never double-spend our
// rate-limit budget on a cache miss.
let liveFailure: Cache<Error> | null = null;
let todayHistoryFailure: Cache<Error> | null = null;
let rangeHistoryFailure: Cache<Error> | null = null;
let lifetimeFailure: Cache<Error> | null = null;

let liveInFlight: Promise<PvSnapshot> | null = null;
let todayHistoryInFlight: Promise<HistoryPoint[]> | null = null;
let rangeHistoryInFlight: Promise<{
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

function zurichDayKey(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

/** Mitternacht des genannten Schweizer Kalendertags, als Unix-ms. */
function zurichMidnight(dayKey: string): number {
  const utcMidnight = Date.parse(`${dayKey}T00:00:00Z`);
  const zurichHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(utcMidnight)),
  );
  return utcMidnight - zurichHour * 60 * 60 * 1000;
}

function shiftDayKey(dayKey: string, days: number): string {
  const shifted = new Date(zurichMidnight(dayKey) + days * 24 * 60 * 60 * 1000);
  return zurichDayKey(shifted);
}

async function fetchTodayHistory(): Promise<HistoryPoint[]> {
  const { stationCode } = await resolveStationInfo();
  const hourSeries = await api.getStationHourKpi([stationCode], zurichMidnight(zurichDayKey()));
  return mapHourSeriesToToday(hourSeries);
}

async function fetchRangeHistory(): Promise<{
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}> {
  const { stationCode } = await resolveStationInfo();
  const devices = await resolveDevices(stationCode);
  const hasBattery = devices.batteryIds.length > 0;
  const todayKey = zurichDayKey();
  const [year, month, day] = todayKey.split("-").map(Number);
  const startOfMonth = zurichMidnight(`${year}-${String(month).padStart(2, "0")}-01`);
  const startOfYear = zurichMidnight(`${year}-01-01`);
  const prevMonthKey = shiftDayKey(`${year}-${String(month).padStart(2, "0")}-01`, -1).slice(0, 7);
  const startOfPrevMonth = zurichMidnight(`${prevMonthKey}-01`);

  const [monthDays, prevMonthDays, yearMonths] = await Promise.all([
    api.getStationDayKpi([stationCode], startOfMonth),
    day < 7 ? api.getStationDayKpi([stationCode], startOfPrevMonth) : Promise.resolve([]),
    api.getStationMonthKpi([stationCode], startOfYear).catch((err) => {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      console.error("[fusionsolar] Monatsdaten (Jahr) nicht verfügbar:", message);
      return [] as Awaited<ReturnType<typeof api.getStationMonthKpi>>;
    }),
  ]);

  const combinedDays = [...prevMonthDays, ...monthDays];
  return {
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

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Einmaliger Abruf ohne den Kurzzeit-Speicher. Für den versteckten Dev-Knopf. */
export async function loadFusionSolarFresh(): Promise<{
  snapshot: PvSnapshot | null;
  history: {
    today: HistoryPoint[];
    week: DailyEnergyPoint[];
    month: DailyEnergyPoint[];
    year: DailyEnergyPoint[];
    lifetime: DailyEnergyPoint[];
  } | null;
  error: Error | null;
}> {
  const [snapshotResult, todayResult, rangesResult, lifetimeResult] = await Promise.allSettled([
    fetchLiveSnapshot(),
    fetchTodayHistory(),
    fetchRangeHistory(),
    fetchLifetime(),
  ]);

  if (snapshotResult.status === "fulfilled") {
    liveCache = { value: snapshotResult.value, expiresAt: Date.now() + LIVE_TTL_MS };
    liveFailure = null;
  } else {
    liveFailure = { value: asError(snapshotResult.reason), expiresAt: Date.now() + LIVE_TTL_MS };
  }

  if (todayResult.status === "fulfilled") {
    todayHistoryCache = { value: todayResult.value, expiresAt: Date.now() + TODAY_HISTORY_TTL_MS };
    todayHistoryFailure = null;
  } else {
    todayHistoryFailure = {
      value: asError(todayResult.reason),
      expiresAt: Date.now() + TODAY_HISTORY_TTL_MS,
    };
  }

  if (rangesResult.status === "fulfilled") {
    rangeHistoryCache = { value: rangesResult.value, expiresAt: Date.now() + SLOW_HISTORY_TTL_MS };
    rangeHistoryFailure = null;
  } else {
    rangeHistoryFailure = { value: asError(rangesResult.reason), expiresAt: Date.now() + LIVE_TTL_MS };
  }

  if (lifetimeResult.status === "fulfilled") {
    lifetimeCache = { value: lifetimeResult.value, expiresAt: Date.now() + LIFETIME_TTL_MS };
    lifetimeFailure = null;
  } else {
    lifetimeFailure = { value: asError(lifetimeResult.reason), expiresAt: Date.now() + LIVE_TTL_MS };
  }

  const history =
    todayResult.status === "fulfilled" &&
    rangesResult.status === "fulfilled" &&
    lifetimeResult.status === "fulfilled"
      ? {
          today: todayResult.value,
          ...rangesResult.value,
          lifetime: lifetimeResult.value,
        }
      : null;

  const rejected = [snapshotResult, todayResult, rangesResult, lifetimeResult].find(
    (result) => result.status === "rejected",
  );

  return {
    snapshot: snapshotResult.status === "fulfilled" ? snapshotResult.value : null,
    history,
    error: rejected && rejected.status === "rejected" ? asError(rejected.reason) : null,
  };
}

export async function getFusionSolarLiveSnapshot(): Promise<PvSnapshot> {
  if (fresh(liveCache)) return liveCache.value;
  if (fresh(liveFailure)) throw liveFailure.value;
  if (!liveInFlight) {
    liveInFlight = fetchLiveSnapshot()
      .then((snapshot) => {
        liveCache = { value: snapshot, expiresAt: Date.now() + LIVE_TTL_MS };
        liveFailure = null;
        return snapshot;
      })
      .catch((err: unknown) => {
        const error = asError(err);
        liveFailure = { value: error, expiresAt: Date.now() + LIVE_TTL_MS };
        throw error;
      })
      .finally(() => {
        liveInFlight = null;
      });
  }
  return liveInFlight;
}

async function getTodayHistory(): Promise<HistoryPoint[]> {
  if (fresh(todayHistoryCache)) return todayHistoryCache.value;
  if (fresh(todayHistoryFailure)) throw todayHistoryFailure.value;
  if (!todayHistoryInFlight) {
    todayHistoryInFlight = fetchTodayHistory()
      .then((today) => {
        todayHistoryCache = { value: today, expiresAt: Date.now() + TODAY_HISTORY_TTL_MS };
        todayHistoryFailure = null;
        return today;
      })
      .catch((err: unknown) => {
        const error = asError(err);
        todayHistoryFailure = { value: error, expiresAt: Date.now() + TODAY_HISTORY_TTL_MS };
        throw error;
      })
      .finally(() => {
        todayHistoryInFlight = null;
      });
  }
  return todayHistoryInFlight;
}

async function getRangeHistory(): Promise<{
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}> {
  if (fresh(rangeHistoryCache)) return rangeHistoryCache.value;
  if (fresh(rangeHistoryFailure)) throw rangeHistoryFailure.value;
  if (!rangeHistoryInFlight) {
    rangeHistoryInFlight = fetchRangeHistory()
      .then((ranges) => {
        rangeHistoryCache = { value: ranges, expiresAt: Date.now() + SLOW_HISTORY_TTL_MS };
        rangeHistoryFailure = null;
        return ranges;
      })
      .catch((err: unknown) => {
        const error = asError(err);
        rangeHistoryFailure = { value: error, expiresAt: Date.now() + LIVE_TTL_MS };
        throw error;
      })
      .finally(() => {
        rangeHistoryInFlight = null;
      });
  }
  return rangeHistoryInFlight;
}

export async function getFusionSolarHistory(): Promise<{
  today: HistoryPoint[];
  week: DailyEnergyPoint[];
  month: DailyEnergyPoint[];
  year: DailyEnergyPoint[];
}> {
  const [today, ranges] = await Promise.all([getTodayHistory(), getRangeHistory()]);
  return { today, ...ranges };
}

export async function getFusionSolarLifetimeHistory(): Promise<DailyEnergyPoint[]> {
  if (fresh(lifetimeCache)) return lifetimeCache.value;
  if (fresh(lifetimeFailure)) throw lifetimeFailure.value;
  if (!lifetimeInFlight) {
    lifetimeInFlight = fetchLifetime()
      .then((lifetime) => {
        lifetimeCache = { value: lifetime, expiresAt: Date.now() + LIFETIME_TTL_MS };
        lifetimeFailure = null;
        return lifetime;
      })
      .catch((err: unknown) => {
        const error = asError(err);
        lifetimeFailure = { value: error, expiresAt: Date.now() + LIVE_TTL_MS };
        throw error;
      })
      .finally(() => {
        lifetimeInFlight = null;
      });
  }
  return lifetimeInFlight;
}

export async function getFusionSolarDashboardData(): Promise<FusionSolarDashboardData> {
  const [snapshot, history, lifetime] = await Promise.all([
    getFusionSolarLiveSnapshot(),
    getFusionSolarHistory(),
    getFusionSolarLifetimeHistory(),
  ]);
  return { snapshot, ...history, lifetime };
}
