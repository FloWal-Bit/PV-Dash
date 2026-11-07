import type { MetadataRoute } from "next";
import { APP_ICON_SRC } from "@/lib/version";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PV Dash",
    short_name: "PV Dash",
    description:
      "Behalte deine Solaranlage im Blick: Erzeugung, Verbrauch, Speicher und Ertrag – schlicht und intuitiv.",
    start_url: "/",
    // standalone statt fullscreen: unter fullscreen färbt Android die
    // System-Navigation mit theme_color (früher Orange, blieb trotz dunklem
    // theme_color oft gecacht). standalone zeigt die Nav-Leiste systemüblich.
    display: "standalone",
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
