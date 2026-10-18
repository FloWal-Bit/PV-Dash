import type { SiteLocation } from "@/lib/site-location";
import type { YieldForecastPlant } from "@/lib/yield-forecast-settings";

/** Aufgelöste Entwicklereinstellungen. Dieselben Werte gelten für jede Instanz. */
export type SharedDevSettings = {
  siteLocation: SiteLocation;
  siteLocationCustom: boolean;
  yieldForecast: YieldForecastPlant;
  hideSimulated: boolean;
  configured: boolean;
  updatedAt: string | null;
};

export type DevSettingsUpdate = {
  siteLocation?: SiteLocation;
  yieldForecast?: YieldForecastPlant;
  hideSimulated?: boolean;
};
