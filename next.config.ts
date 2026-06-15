import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keryx serves live data (agent runs, payments, metrics) — no static caching.
  // cacheComponents is intentionally off so API routes are always dynamic/fresh.
};

export default nextConfig;
