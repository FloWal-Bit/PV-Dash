import { getSiteLocation, getSunInfo } from "@/lib/sun";

/**
 * Simulierte PV-Daten (Photovoltaik).
 *
 * Es ist keine echte Wechselrichter-Anbindung (z. B. SolarEdge, Fronius, SMA,
 * Home Assistant) hinterlegt. Stattdessen wird eine realistische Tageskurve
 * anhand der aktuellen Uhrzeit berechnet, damit sich die App wie eine echte
 * PV-Überwachung anfühlt. Für eine reale Anbindung reicht es, `getSnapshot`
 * und `getHistory` durch echte API-Aufrufe zu ersetzen.
 */

export type PvSnapshot = {
  timestamp: number;
  /** Aktuelle PV-Erzeugung in kW */
  productionKw: number;
  /**
   * Aktueller Hausverbrauch in kW. `null`, wenn die angebundene Datenquelle
   * (z. B. FusionSolar ohne Zähler/Smart-Meter am Anlagen-Gateway) diesen
   * Wert nicht liefert.
   */
  consumptionKw: number | null;
  /**
   * Netzbezug (positiv) oder Einspeisung (negativ) in kW. `null`, wenn nicht
   * verfügbar (siehe `consumptionKw`).
   */
  gridKw: number | null;
  /** Ladezustand des Speichers in % (0-100). `null`, wenn keine Batterie vorhanden/gemeldet wird. */
  batterySoc: number | null;
  /** Batterie-Leistung: positiv = laden, negativ = entladen (kW). `null`, wenn keine Batterie vorhanden/gemeldet wird. */
  batteryKw: number | null;
  /** Heute erzeugte Energie in kWh */
  todayYieldKwh: number;
  /**
   * Heute verbrauchte Energie in kWh. `null`, wenn die angebundene
   * Datenquelle das nicht meldet (siehe `consumptionKw`).
   */
  todayConsumptionKwh: number | null;
  /** Gesamte (Lifetime) erzeugte Energie in kWh */
  totalYieldKwh: number;
  /**
   * Heute ins Netz eingespeiste Energie in kWh (brutto, nur Überschuss-
   * Zeiträume). `null`, wenn die angebundene Datenquelle das nicht meldet.
   */
  gridFeedInTodayKwh: number | null;
  /**
   * Heute vom Netzbetreiber bezogene Energie in kWh (brutto, nur Zeiträume
   * mit Netzbezug). `null`, wenn die angebundene Datenquelle das nicht
   * meldet.
   */
  gridImportTodayKwh: number | null;
  /**
   * Stromkonto-Stand in kWh (Startstand 516 + laufende Netto-Veränderung).
   * `null`, wenn keine Netz-/Zählerdaten verfügbar sind.
   */
  stromkontoBalanceKwh: number | null;
  /** Netto-Veränderung Stromkonto heute (Einspeisung minus Bezug). */
  stromkontoChangeTodayKwh: number | null;
  /** Eigenverbrauchsquote in %. `null`, wenn Verbrauchsdaten fehlen. */
  selfConsumptionRate: number | null;
  /** Autarkiegrad in %. `null`, wenn Verbrauchsdaten fehlen. */
  autarkyRate: number | null;
  /** Peak-Leistung der Anlage in kWp */
  systemPeakKwp: number;
  /** Wettersituation, beeinflusst die Erzeugungskurve */
  weather: "sonnig" | "leicht bewölkt" | "bewölkt" | "regnerisch";
  /** Gesundheitsstatus der Anlage, sofern von der Datenquelle gemeldet. */
  healthState?: "online" | "offline" | "fault" | null;
};

export type HistoryPoint = {
  time: string;
  label: string;
  productionKw: number;
  consumptionKw: number;
};

export type DailyEnergyPoint = {
  label: string;
  yieldKwh: number;
  consumptionKwh: number;
  /** Anteil von `consumptionKwh`, der direkt aus der PV-Erzeugung gedeckt wurde (kWh). */
  directSolarKwh: number;
  /** Anteil von `consumptionKwh`, der aus dem Speicher (Batterie) entladen wurde (kWh). */
  batteryKwh: number;
};

const SYSTEM_PEAK_KWP = 8.4;

// Seeded pseudo-randomness, damit die Kurve pro Sekunde nicht komplett neu
// "flackert", sondern sich weich innerhalb plausibler Grenzen bewegt.
function smoothNoise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function weatherFactor(minuteOfDay: number): {
  factor: number;
  weather: PvSnapshot["weather"];
} {
  const cycle = smoothNoise(Math.floor(minuteOfDay / 45));
  if (cycle > 0.82) return { factor: 0.35, weather: "regnerisch" };
  if (cycle > 0.6) return { factor: 0.62, weather: "bewölkt" };
  if (cycle > 0.35) return { factor: 0.85, weather: "leicht bewölkt" };
  return { factor: 1, weather: "sonnig" };
}

/**
 * Glockenkurve für die Sonneneinstrahlung zwischen Sonnenaufgang (6:30) und
 * Sonnenuntergang (20:30), mit leichtem Rauschen für Realismus.
 */
function solarCurve(date: Date): { productionKw: number; weather: PvSnapshot["weather"] } {
  const sun = getSunInfo(date, getSiteLocation());
  if (date.getTime() < sun.sunrise.getTime() || date.getTime() > sun.sunset.getTime()) {
    return { productionKw: 0, weather: "sonnig" };
  }

  const minuteOfDay = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const sunrise = sun.sunrise.getHours() * 60 + sun.sunrise.getMinutes();
  const sunset = sun.sunset.getHours() * 60 + sun.sunset.getMinutes();
  const dayLength = Math.max(1, sunset - sunrise);
  const t = (minuteOfDay - sunrise) / dayLength; // 0..1
  const base = Math.sin(Math.PI * t); // 0 -> 1 -> 0

  const { factor, weather } = weatherFactor(minuteOfDay);
  const noise = 0.94 + smoothNoise(minuteOfDay) * 0.12;

  const productionKw = Math.max(0, SYSTEM_PEAK_KWP * Math.pow(base, 1.3) * factor * noise);
  return { productionKw, weather };
}

function consumptionCurve(date: Date): number {
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const morning = Math.exp(-Math.pow((minuteOfDay - 7 * 60 + 30) / 90, 2)) * 1.4;
  const noon = Math.exp(-Math.pow((minuteOfDay - 12 * 60 + 30) / 100, 2)) * 1.1;
  const evening = Math.exp(-Math.pow((minuteOfDay - 19 * 60) / 110, 2)) * 2.1;
  const base = 0.32 + morning + noon + evening;
  const noise = 0.9 + smoothNoise(minuteOfDay * 1.7) * 0.2;
  return Math.max(0.15, base * noise);
}

function integrateYieldUntil(date: Date): number {
  let total = 0;
  const stepMinutes = 10;
  const totalMinutesToday = date.getHours() * 60 + date.getMinutes();
  for (let m = 0; m <= totalMinutesToday; m += stepMinutes) {
    const sample = new Date(date);
    sample.setHours(0, m, 0, 0);
    total += solarCurve(sample).productionKw * (stepMinutes / 60);
  }
  return total;
}

function integrateConsumptionUntil(date: Date): number {
  let total = 0;
  const stepMinutes = 10;
  const totalMinutesToday = date.getHours() * 60 + date.getMinutes();
  for (let m = 0; m <= totalMinutesToday; m += stepMinutes) {
    const sample = new Date(date);
    sample.setHours(0, m, 0, 0);
    total += consumptionCurve(sample) * (stepMinutes / 60);
  }
  return total;
}

/** Summe der Überschussleistung (Erzeugung > Verbrauch), die bis jetzt ins Netz eingespeist wurde. */
function integrateGridFeedInUntil(date: Date): number {
  let total = 0;
  const stepMinutes = 10;
  const totalMinutesToday = date.getHours() * 60 + date.getMinutes();
  for (let m = 0; m <= totalMinutesToday; m += stepMinutes) {
    const sample = new Date(date);
    sample.setHours(0, m, 0, 0);
    const surplusKw = Math.max(0, solarCurve(sample).productionKw - consumptionCurve(sample));
    total += surplusKw * (stepMinutes / 60);
  }
  return total;
}

/** Summe der Fehlleistung (Verbrauch > Erzeugung), die bis jetzt vom Netzbetreiber bezogen wurde. */
function integrateGridImportUntil(date: Date): number {
  let total = 0;
  const stepMinutes = 10;
  const totalMinutesToday = date.getHours() * 60 + date.getMinutes();
  for (let m = 0; m <= totalMinutesToday; m += stepMinutes) {
    const sample = new Date(date);
    sample.setHours(0, m, 0, 0);
    const deficitKw = Math.max(0, consumptionCurve(sample) - solarCurve(sample).productionKw);
    total += deficitKw * (stepMinutes / 60);
  }
  return total;
}

/**
 * Schätzt für einen Tagesertrag/-verbrauch, welcher Anteil des Verbrauchs
 * direkt aus der PV-Erzeugung gedeckt wurde und welcher Anteil aus dem
 * Speicher entladen wurde (Rest = Netzbezug, wird hier nicht ausgewiesen).
 * `overlapFactor` bildet ab, wie gut sich Erzeugungs- und Verbrauchskurve
 * zeitlich überschneiden; `batteryShare` den Anteil der verbleibenden
 * Nachfrage, der aus dem Speicher statt vom Netz gedeckt wird.
 */
function splitConsumption(
  yieldKwh: number,
  consumptionKwh: number,
  seed: number,
): { directSolarKwh: number; batteryKwh: number } {
  const overlapFactor = 0.5 + smoothNoise(seed * 7.7) * 0.3; // 0.5–0.8
  const directSolarKwh = Math.min(yieldKwh, consumptionKwh) * overlapFactor;
  const remainingDemand = Math.max(0, consumptionKwh - directSolarKwh);
  const batteryShare = 0.3 + smoothNoise(seed * 11.3) * 0.35; // 0.3–0.65 der Restnachfrage
  const batteryKwh = remainingDemand * batteryShare;
  return { directSolarKwh: round(directSolarKwh), batteryKwh: round(batteryKwh) };
}

const LIFETIME_BASE_KWH = 18_452;
const INSTALL_TIMESTAMP = new Date("2023-04-01T00:00:00").getTime();

export function getSnapshot(now: Date = new Date()): PvSnapshot {
  const { productionKw, weather } = solarCurve(now);
  const consumptionKw = consumptionCurve(now);
  const gridKw = consumptionKw - productionKw;

  const surplus = productionKw - consumptionKw;
  let batteryKw = 0;
  let batterySoc = 55 + Math.sin(now.getHours() / 3.8) * 25;
  if (surplus > 0) {
    batteryKw = Math.min(surplus, 3);
    batterySoc = Math.min(97, batterySoc + batteryKw * 2);
  } else {
    batteryKw = -Math.min(Math.abs(surplus), 2.5);
    batterySoc = Math.max(12, batterySoc + batteryKw * 2);
  }

  const todayYieldKwh = integrateYieldUntil(now);
  const todayConsumptionKwh = integrateConsumptionUntil(now);
  const gridFeedInTodayKwh = integrateGridFeedInUntil(now);
  const gridImportTodayKwh = integrateGridImportUntil(now);
  const daysSinceInstall = Math.max(
    1,
    Math.floor((now.getTime() - INSTALL_TIMESTAMP) / (1000 * 60 * 60 * 24)),
  );
  const totalYieldKwh = LIFETIME_BASE_KWH + daysSinceInstall * 14.2 + todayYieldKwh;

  const selfConsumptionRate = productionKw > 0.05
    ? Math.min(100, (Math.min(productionKw, consumptionKw) / productionKw) * 100)
    : 0;
  const autarkyRate = consumptionKw > 0.05
    ? Math.min(100, (Math.min(productionKw, consumptionKw) / consumptionKw) * 100)
    : 0;

  return {
    timestamp: now.getTime(),
    productionKw: round(productionKw),
    consumptionKw: round(consumptionKw),
    gridKw: round(gridKw),
    batterySoc: Math.round(batterySoc),
    batteryKw: round(batteryKw),
    todayYieldKwh: round(todayYieldKwh),
    todayConsumptionKwh: round(todayConsumptionKwh),
    totalYieldKwh: round(totalYieldKwh),
    gridFeedInTodayKwh: round(gridFeedInTodayKwh),
    gridImportTodayKwh: round(gridImportTodayKwh),
    stromkontoBalanceKwh: null,
    stromkontoChangeTodayKwh: null,
    selfConsumptionRate: Math.round(selfConsumptionRate),
    autarkyRate: Math.round(autarkyRate),
    systemPeakKwp: SYSTEM_PEAK_KWP,
    weather,
  };
}

export function getTodayHistory(now: Date = new Date()): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  // 5-Minuten-Auflösung für die Tageskurve (PV-Ausgabe / Leistungsaufnahme).
  const stepMinutes = 5;
  const totalMinutesToday = now.getHours() * 60 + now.getMinutes();

  for (let m = 0; m <= 24 * 60; m += stepMinutes) {
    const sample = new Date(now);
    sample.setHours(0, m, 0, 0);
    const isFuture = m > totalMinutesToday;
    const production = isFuture ? 0 : solarCurve(sample).productionKw;
    const consumption = isFuture ? 0 : consumptionCurve(sample);
    points.push({
      time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
      label: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
      productionKw: round(production),
      consumptionKw: round(consumption),
    });
  }
  return points;
}

const WEEKDAYS_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function getWeekHistory(now: Date = new Date()): DailyEnergyPoint[] {
  const points: DailyEnergyPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const seed = day.getFullYear() * 400 + day.getMonth() * 31 + day.getDate();
    const weatherScale = 0.55 + smoothNoise(seed) * 0.5;
    const yieldKwh = i === 0
      ? integrateYieldUntil(now)
      : round(38 * weatherScale + smoothNoise(seed * 3.1) * 6);
    const consumptionKwh = round(24 + smoothNoise(seed * 5.3) * 10);
    const { directSolarKwh, batteryKwh } = splitConsumption(yieldKwh, consumptionKwh, seed);
    points.push({
      // Der aktuelle Tag heißt "Heute" statt des Wochentagskürzels, analog
      // zur Verlaufsansicht in gängigen PV-Monitoring-Apps.
      label: i === 0 ? "Heute" : WEEKDAYS_DE[day.getDay()],
      yieldKwh: round(yieldKwh),
      consumptionKwh,
      directSolarKwh,
      batteryKwh,
    });
  }
  return points;
}

export function getMonthHistory(now: Date = new Date()): DailyEnergyPoint[] {
  const points: DailyEnergyPoint[] = [];
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayDate = now.getDate();

  for (let day = 1; day <= todayDate; day++) {
    const sample = new Date(year, month, day);
    const seed = year * 400 + month * 31 + day;
    const weatherScale = 0.55 + smoothNoise(seed) * 0.5;
    const yieldKwh =
      day === todayDate
        ? round(integrateYieldUntil(now))
        : round(38 * weatherScale + smoothNoise(seed * 3.1) * 6);
    const consumptionKwh = round(24 + smoothNoise(seed * 5.3) * 10);
    const { directSolarKwh, batteryKwh } = splitConsumption(yieldKwh, consumptionKwh, seed);
    points.push({
      label: day === todayDate ? "Heute" : String(day),
      yieldKwh: round(yieldKwh),
      consumptionKwh,
      directSolarKwh,
      batteryKwh,
    });
  }
  return points;
}

// Grob am Mittel der Wochen-/Monatssimulation ausgerichtet (dort ~30 kWh/Tag
// Ertrag bzw. ~24 kWh/Tag Verbrauch im Mittel), damit Jahres- und
// "Lebensdauer"-Säulen größenordnungsmäßig zu Woche/Monat passen.
const LIFETIME_AVG_DAILY_YIELD_KWH = 30;
const LIFETIME_AVG_DAILY_CONSUMPTION_KWH = 24;

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/**
 * Monatsübersicht des laufenden Kalenderjahres. Vergangene Monate zählen
 * voll, der aktuelle Monat nur bis heute. Die Ertragskurve folgt grob der
 * saisonalen Einstrahlung in der Schweiz (Sommer höher, Winter niedriger).
 */
export function getYearHistory(now: Date = new Date()): DailyEnergyPoint[] {
  const points: DailyEnergyPoint[] = [];
  const year = now.getFullYear();
  const currentMonth = now.getMonth();

  for (let month = 0; month <= currentMonth; month++) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const elapsedDays = month === currentMonth ? now.getDate() : daysInMonth;
    const seed = year * 400 + month * 31 + 19;
    // ~0.45 im Januar, ~1.0 im Juni/Juli, ~0.5 im Dezember
    const seasonal = 0.45 + 0.55 * Math.sin((Math.PI * (month + 0.2)) / 11);
    const weatherScale = 0.9 + smoothNoise(seed) * 0.2;
    const yieldKwh = round(
      elapsedDays * LIFETIME_AVG_DAILY_YIELD_KWH * seasonal * weatherScale,
    );
    const consumptionKwh = round(
      elapsedDays * LIFETIME_AVG_DAILY_CONSUMPTION_KWH * (0.9 + smoothNoise(seed * 2.2) * 0.2),
    );
    const { directSolarKwh, batteryKwh } = splitConsumption(yieldKwh, consumptionKwh, seed);
    points.push({
      label: month === currentMonth ? "Dieser Monat" : MONTHS_DE[month],
      yieldKwh,
      consumptionKwh,
      directSolarKwh,
      batteryKwh,
    });
  }

  return points;
}

/** Anzahl der Tage zwischen zwei Zeitpunkten (kann Bruchteile enthalten). */
function daysBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Jahresübersicht seit Inbetriebnahme der Anlage ("Lebensdauer"). Für
 * vollständig vergangene Jahre wird ein plausibler Jahresertrag anhand der
 * durchschnittlichen Tagesrate mit leichter, seedbasierter Jahresschwankung
 * simuliert; das laufende Jahr zählt nur die bereits vergangenen Tage.
 */
export function getLifetimeHistory(now: Date = new Date()): DailyEnergyPoint[] {
  const installDate = new Date(INSTALL_TIMESTAMP);
  const points: DailyEnergyPoint[] = [];

  for (let year = installDate.getFullYear(); year <= now.getFullYear(); year++) {
    const yearStart = new Date(Math.max(installDate.getTime(), new Date(year, 0, 1).getTime()));
    const yearEnd = year === now.getFullYear() ? now : new Date(year, 11, 31, 23, 59, 59, 999);
    const elapsedDays = daysBetween(yearStart, yearEnd);

    const seed = year * 97 + 13;
    const yieldScale = 0.85 + smoothNoise(seed) * 0.3; // 0.85–1.15, Jahresschwankung
    const consumptionScale = 0.9 + smoothNoise(seed * 2.3) * 0.2; // 0.9–1.1
    const yieldKwh = elapsedDays * LIFETIME_AVG_DAILY_YIELD_KWH * yieldScale;
    const consumptionKwh = elapsedDays * LIFETIME_AVG_DAILY_CONSUMPTION_KWH * consumptionScale;
    const { directSolarKwh, batteryKwh } = splitConsumption(yieldKwh, consumptionKwh, seed);

    points.push({
      label: String(year),
      yieldKwh: round(yieldKwh),
      consumptionKwh: round(consumptionKwh),
      directSolarKwh,
      batteryKwh,
    });
  }

  return points;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
