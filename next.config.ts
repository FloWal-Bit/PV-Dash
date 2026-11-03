import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js dev server blocks cross-origin requests to dev-only assets
  // (HMR websocket, static chunks) unless the requesting origin is
  // allowlisted. The preview/proxy may reach this app via 127.0.0.1, the
  // pod's internal IP, or a forwarded hostname instead of "localhost", so
  // without this, the client bundle silently gets 403'd and the app never
  // hydrates (stuck showing the server-rendered skeleton forever).
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // Prebuilt-Deploy für Infomaniak: `.next/standalone` enthält server.js +
  // getrace'te node_modules. Jelastic baut nicht mehr selbst (Cloudlet-Kosten).
  output: "standalone",

  // Weniger Peak-RAM beim Production-Build (lokal/CI).
  // Kein custom `webpack()`-Hook: sonst fällt der Default-Build-Worker weg.
  productionBrowserSourceMaps: false,
  enablePrerenderSourceMaps: false,
  experimental: {
    cpus: 1,
    webpackMemoryOptimizations: true,
    serverSourceMaps: false,
  },

  // Icon-URL trägt ?v=APP_VERSION; kurze Revalidierung hilft ohne Query-String.
  async headers() {
    return [
      {
        source: "/icon.svg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
