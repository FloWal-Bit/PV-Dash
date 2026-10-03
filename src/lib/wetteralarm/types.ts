export type WetterAlarmDayForecast = {
  date: string;
  insolation: number;
  sunrise: string;
  sunset: string;
  symbol: number;
  symbol_v2?: number;
  mood?: string;
  temperature_min: number;
  temperature_max: number;
  precipitation_amount: number;
  precipitation_probability: number;
};

export type WetterAlarmPoiResponse = {
  id: number;
  lat: number;
  long: number;
  time_zone?: string;
  de?: { label: string; geo_subdivision_label?: string; country_label?: string };
  day_forecasts: WetterAlarmDayForecast[];
};

export type WetterAlarmSearchResult = {
  entity_type: string;
  entity_id: number;
  lat: number;
  long: number;
  de?: { label: string };
};

export type WetterAlarmSearchResponse = {
  results: WetterAlarmSearchResult[];
};

export type WetterAlarmDailyWeather = {
  poiId: number;
  locationName: string;
  date: string;
  weatherLabel: string;
  sunrise: string;
  sunset: string;
  sunHours: number;
  source: "wetteralarm";
};
