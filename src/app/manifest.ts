import type { MetadataRoute } from "next";
import { APP_ICON_SRC } from "@/lib/version";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PV Dash",
    short_name: "PV Dash",
    description:
      "Behalte deine Solaranlage im Blick: Erzeugung, Verbrauch, Speicher und Ertrag – schlicht und intuitiv.",
    start_url: "/",
    // fullscreen: Statusleiste (Uhr/Akku) in der installierten PWA ausblenden.
    // theme_color muss der dunkle App-Hintergrund bleiben — sonst färbt
    // Android die System-Navigation mit dem Akzent (früher oranger Balken).
    display: "fullscreen",
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
