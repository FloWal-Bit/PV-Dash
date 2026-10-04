/**
 * Schweizer PLZ-Verzeichnis (Swiss Post / Geonames, via npm-Paket
 * `switzerland-postal-codes`). Nur serverseitig importieren — JSON ~360 KB.
 */

import postalCodesFull from "switzerland-postal-codes/dist/postal-codes-full.json";

export type PlzLocality = {
  name: string;
  canton: string;
  latitude: number;
  longitude: number;
};

type RawEntry = {
  name: string;
  canton: string;
  latitude: string;
  longitude: string;
};

const directory = postalCodesFull as Record<string, RawEntry[]>;

export function isValidSwissPlz(plz: string): boolean {
  return /^\d{4}$/.test(plz.trim());
}

export function lookupPlzLocalities(plz: string): PlzLocality[] {
  const key = plz.trim();
  if (!isValidSwissPlz(key)) return [];

  const rows = directory[key];
  if (!rows?.length) return [];

  return rows.map((row) => ({
    name: row.name.trim(),
    canton: row.canton.trim(),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  })).filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
}
