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
    background_color: "#fbf9f5",
    theme_color: "#e2a33d",
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
