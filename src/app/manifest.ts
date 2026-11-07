import type { MetadataRoute } from "next";
import { APP_ICON_SRC } from "@/lib/version";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PV Dash",
    short_name: "PV Dash",
    description:
      "Behalte deine Solaranlage im Blick: Erzeugung, Verbrauch, Speicher und Ertrag – schlicht und intuitiv.",
    start_url: "/",
    display: "fullscreen",
    orientation: "any",
    // theme_color färbt auf Android die System-Navigation. Nicht das
    // Akzent-Orange (#e2a33d) — das wirkte seit display:fullscreen als
    // oranger Balken über den Navigationstasten. Dunkler App-Hintergrund.
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
