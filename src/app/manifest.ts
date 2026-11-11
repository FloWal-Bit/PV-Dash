import type { MetadataRoute } from "next";
import { APP_ICON_SRC } from "@/lib/version";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PV Dash",
    short_name: "PV Dash",
    description:
      "Behalte deine Solaranlage im Blick: Erzeugung, Verbrauch, Speicher und Ertrag – schlicht und intuitiv.",
    start_url: "/",
    // fullscreen: Status- und Navigationsleiste in der installierten PWA aus.
    // display_override: Chrome bevorzugt fullscreen vor älterem standalone-Cache.
    // theme_color = dunkler App-Hintergrund — sonst färbt Android die Navi
    // mit dem Akzent (früher oranger Balken).
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any",
    background_color: "#171d2c",
    theme_color: "#171d2c",
    icons: [
      {
        src: APP_ICON_SRC,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: APP_ICON_SRC,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
