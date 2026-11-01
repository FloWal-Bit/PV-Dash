export const APP_NAME = "PV Dash";
export const APP_VERSION = "1.5.7";
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

/**
 * Cache-Bust für Favicon, Lesezeichen und PWA-/Homescreen-Icons.
 * Bei Icon-Änderungen die App-Version mit anheben, damit Geräte die neue Datei laden.
 */
export const APP_ICON_SRC = `/icon.svg?v=${APP_VERSION}`;
export const APP_MANIFEST_SRC = `/manifest.webmanifest?v=${APP_VERSION}`;
