/** Gemeinsame Entwicklereinstellungen ohne Standort und ohne Anlagenkoordinaten. */

export type SharedDevSettings = {
  hideSimulated: boolean;
  configured: boolean;
  updatedAt: string | null;
};

export type DevSettingsUpdate = {
  hideSimulated?: boolean;
};
