/** Nutzerdoku für das Einstellungsmenü. Datum = letzte fachliche Änderung. */

export type DocEntry = {
  title: string;
  updated: string;
  body: string;
};

export const DOCUMENTATION: DocEntry[] = [
  {
    title: "FusionSolar",
    updated: "16. Oktober 2026",
    body: "Leistung und Status kommen höchstens alle 6 Minuten. Die heutige Stundenreihe in Ertrag & Verbrauch einmal pro Stunde, Woche, Monat, Jahr und Laufzeit zweimal täglich. Lokal fragt der Dev-Server Huawei nicht ab, bis im Backlog nachgeladen wird.",
  },
  {
    title: "whatwatt Go",
    updated: "10. Oktober 2026",
    body: "Netzbezug und Einspeisung kommen per MQTT, etwa alle 15 Sekunden, solange das Dashboard offen ist. Bleibt eine Nachricht länger als 5 Minuten aus, gilt der Zählerstand als veraltet.",
  },
  {
    title: "Ertrag & Verbrauch",
    updated: "16. Oktober 2026",
    body: "Die Verläufe stammen von FusionSolar. Die Stundenwerte sind bereits in kWh. Fehlt der Gesamtverbrauch, wird der Eigenverbrauch gezeigt.",
  },
  {
    title: "Stromkonto",
    updated: "11. Oktober 2026",
    body: "Der Stand folgt dem whatwatt-Zähler. Stromkonto heute beginnt um 00:00 Uhr Schweizer Zeit neu und zählt Einspeisung minus Bezug.",
  },
  {
    title: "Wetter-Alarm",
    updated: "4. Oktober 2026",
    body: "Wetter, Sonnenaufgang, Sonnenuntergang und Sonnenstunden kommen vom Standort in den Einstellungen. Der Server hält die Antwort 12 Stunden.",
  },
  {
    title: "Ertragsprognose",
    updated: "3. Oktober 2026",
    body: "Open-Meteo rechnet die Prognose aus Globalstrahlung, Anlagenleistung und einem Leistungsfaktor von 0,78. Sie steht auf der Karte für heute und morgen.",
  },
  {
    title: "Anzeige und Status",
    updated: "16. Oktober 2026",
    body: "Grün heisst, die Quelle liefert. Orange ist eine Störung, ein Tipp zeigt den Grund. Grau bedeutet Simulation ohne Fehlermeldung. Simulierte Werte blendet das Backlog aus, nach fünf Tipps auf PV Dash.",
  },
  {
    title: "Hosting",
    updated: "3. Oktober 2026",
    body: "Die App läuft in den Schweizer Rechenzentren von Infomaniak in Genf. Die Infrastruktur wird zu 100 % mit erneuerbarer Energie betrieben.",
  },
];
