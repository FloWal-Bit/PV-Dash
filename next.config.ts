import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js dev server blocks cross-origin requests to dev-only assets
  // (HMR websocket, static chunks) unless the requesting origin is
  // allowlisted. The preview/proxy may reach this app via 127.0.0.1, the
  // pod's internal IP, or a forwarded hostname instead of "localhost", so
  // without this, the client bundle silently gets 403'd and the app never
  // hydrates (stuck showing the server-rendered skeleton forever).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
