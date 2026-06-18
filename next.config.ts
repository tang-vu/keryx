import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keryx serves live data (agent runs, payments, metrics) — no static caching.
  // cacheComponents is intentionally off so API routes are always dynamic/fresh.

  // The production VPS has ~1GB RAM (+2GB swap). next build's in-process TypeScript
  // type-check + ESLint were OOM-killed there once the wallet SDK type trees were
  // added, leaving a partial .next (ChunkLoadError 500s). Skip both during the
  // build: types are checked separately with `tsc --noEmit` and lint with eslint
  // before every deploy, so these passes are redundant here — not error-hiding.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
