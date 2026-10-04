/** Client-taugliche Typen für PLZ-Lookup (ohne schweres Verzeichnis). */

export type PlzLocality = {
  name: string;
  canton: string;
  latitude: number;
  longitude: number;
};

export type PlzLookupResponse = {
  plz: string;
  localities: PlzLocality[];
};
