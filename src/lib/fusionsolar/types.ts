/**
 * Rohdatentypen der Huawei FusionSolar Northbound API ("thirdData/..."-Endpunkte).
 * Nur die Felder, die wir tatsächlich auswerten, sind typisiert – die API
 * liefert je nach Anlage/Gerätetyp noch deutlich mehr Felder.
 */

export type FusionSolarEnvelope<T> = {
  success: boolean;
  failCode?: number;
  message?: string | null;
  data?: T;
  params?: Record<string, unknown>;
};

export type StationListItem = {
  plantCode: string;
  plantName: string;
  plantAddress?: string;
  capacity?: number;
};

/** Antwort von thirdData/getStationRealKpi (ein Eintrag pro stationCode). */
export type StationRealKpiItem = {
  stationCode: string;
  dataItemMap: {
    /** Anlagen-Gesundheitsstatus: 1 = getrennt, 2 = gestört, 3 = gesund */
    real_health_state?: string;
    /** Ertrag heute, kWh */
    day_power?: string;
    /** Ertrag diesen Monat, kWh */
    month_power?: string;
    /** Ertrag gesamt (Lifetime), kWh */
    total_power?: string;
    /** Erlös heute (Anlagenwährung) */
    day_income?: string;
    /** Erlös gesamt (Anlagenwährung) */
    total_income?: string;
    /** Netzeinspeisung heute, kWh (nicht auf jeder Anlage verfügbar) */
    day_on_grid_energy?: string;
    /** Verbrauch heute, kWh (nicht auf jeder Anlage verfügbar) */
    day_use_energy?: string;
  };
};

export type DevListItem = {
  id: number;
  devName: string;
  stationCode: string;
  esnCode: string;
  devTypeId: number;
};

/** Gerätetypen, die für die Echtzeit-Anzeige relevant sind (siehe getDevList). */
export const DEV_TYPE_STRING_INVERTER = 1;
export const DEV_TYPE_RESIDENTIAL_INVERTER = 38;
export const DEV_TYPE_BATTERY = 39;
export const DEV_TYPE_ESS = 41;
export const DEV_TYPE_GRID_METER = 17;
export const DEV_TYPE_POWER_SENSOR = 47;

/** Antwort von thirdData/getDevRealKpi für Wechselrichter (devTypeId 1 oder 38). */
export type InverterRealKpiItem = {
  devId: number;
  dataItemMap: {
    /** Momentanleistung, kW */
    active_power?: string;
    /** Ertrag heute, kWh */
    day_cap?: string;
    /** Ertrag gesamt, kWh */
    total_cap?: string;
    /** Wechselrichter-Status, siehe Huawei-Doku Tabelle 5-1 */
    inverter_state?: string;
  };
};

/** Antwort von thirdData/getDevRealKpi für Batterien (devTypeId 39). */
export type BatteryRealKpiItem = {
  devId: number;
  dataItemMap: {
    /** Ladezustand, % */
    battery_soc?: string;
    /** Lade-/Entladeleistung, W (positiv = laden) */
    ch_discharge_power?: string;
  };
};

/** Antwort von thirdData/getDevRealKpi für Netz-/Leistungszähler (devTypeId 17/47). */
export type MeterRealKpiItem = {
  devId: number;
  dataItemMap: {
    /** Momentanleistung, kW */
    active_power?: string;
  };
};

/**
 * Antwort von thirdData/getKpiStationHour|getKpiStationDay|getKpiStationMonth.
 *
 * ACHTUNG: Huaweis Doku gibt für diese Zeitreihen-Endpunkte keine Einheit für
 * `inverter_power`/`ongrid_power`/`use_power` an (im Gegensatz zu
 * `getStationRealKpi`, wo explizit kWh dokumentiert ist). Community-Clients
 * gehen von Wh pro Intervall aus – siehe `WATT_HOURS_TO_KWH` in mapper.ts. Falls
 * sich nach dem Live-Test mit echten Zugangsdaten andere Größenordnungen
 * zeigen, hier den Umrechnungsfaktor anpassen.
 */
export type StationKpiTimeseriesItem = {
  stationCode: string;
  collectTime: number;
  dataItemMap: {
    /** Ertrag im Intervall (Wh, siehe Hinweis oben) */
    inverter_power?: number | null;
    /** Netzeinspeisung im Intervall (Wh) */
    ongrid_power?: number | null;
    /** Verbrauch im Intervall (Wh) */
    use_power?: number | null;
  };
};
