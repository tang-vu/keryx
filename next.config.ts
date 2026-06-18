import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keryx serves live data (agent runs, payments, metrics) — no static caching.
  // cacheComponents is intentionally off so API routes are always dynamic/fresh.

  // The production VPS has ~1GB RAM (+2GB swap). next build's in-process TypeScript
  // type-check was OOM-killed there once the wallet deps were added, leaving a
  // partial .next (ChunkLoadError 500s). Skip it during the build: types are
  // checked separately with `tsc --noEmit` before every deploy, so this pass is
  // redundant here — not error-hiding. (Next 16 no longer runs ESLint in build.)
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
