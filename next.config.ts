import type { NextConfig } from "next";
import {
  appSecurityHeaders,
  contentSecurityPolicy,
  SCALAR_API_REFERENCE_SCRIPT_URL,
} from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Circle SDK 1.1.11 only decodes Google's nonce locally. Rewrite that exact
  // browser-only module, retaining original Node JWT libraries everywhere else.
  turbopack: { rules: { "*": [{ condition: { all: ["browser", {
    path: /node_modules\/@circle-fin\/w3s-pw-web-sdk\/dist\/src\/index\.js$/,
  }] }, loaders: ["./scripts/circle-sdk-browser-loader.cjs"], as: "*.js" }] } },
  // Keryx serves live data (agent runs, payments, metrics) — no static caching.
  // cacheComponents is intentionally off so API routes are always dynamic/fresh.

  // Low-downtime deploy: redeploy-vps.sh builds into a temp dir (NEXT_DIST_DIR=.next.tmp)
  // while the live build keeps serving from .next, then atomically swaps it in and reloads.
  // `next start` is launched WITHOUT the env, so it always serves the default ".next".
  // Unset everywhere else → ".next", so there is no behavior change outside a deploy.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The deploy recreates .next.tmp every time, so its filesystem cache is never reused.
  // Keep normal local/CI cache behavior; skip the wasted write only for that temporary build.
  experimental: {
    turbopackFileSystemCacheForBuild: process.env.NEXT_DIST_DIR !== ".next.tmp",
    // Next isolates static workers from the parent's heap flag. On the small VPS,
    // generating eight pages together exhausted the worker's ~480 MiB heap.
    // A single thread preserves the explicitly configured parent heap; a child
    // process drops it. Verify this with scripts/check-next-worker-memory.cjs.
    ...(process.env.NEXT_DIST_DIR === ".next.tmp" ? { cpus: 1, staticGenerationMaxConcurrency: 1, workerThreads: true } : {}),
  },

  async headers() {
    return [
      { source: "/(.*)", headers: appSecurityHeaders() },
      // Next's configured headers can override Route Handler response headers.
      // Keep the private withdrawal boundary consistent at the framework layer.
      { source: "/api/me/withdrawals/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/me/withdrawals", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      ...["/api/me/bibliographies/:path*", "/api/bibliographies/:path*", "/me/bibliographies"].map(source => ({
        source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      // Matching rules are applied in order, so this CSP replaces the global CSP only for the
      // standalone Scalar document. Other pages still cannot execute scripts from jsDelivr.
      {
        source: "/api/docs",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(undefined, [SCALAR_API_REFERENCE_SCRIPT_URL]),
          },
        ],
      },
    ];
  },

  // The production VPS has ~1GB RAM (+2GB swap). next build's in-process TypeScript
  // type-check was OOM-killed there once the wallet deps were added, leaving a
  // partial .next (ChunkLoadError 500s). Skip it during the build: types are
  // checked separately with `npm run typecheck` before every deploy, so this pass is
  // redundant here — not error-hiding. (Next 16 no longer runs ESLint in build.)
  typescript: { ignoreBuildErrors: true },

  // The Unified Balance Kit pulls in Solana tooling at module top-level; bundling
  // it would bloat the server build (and the 1GB-RAM VPS build step). Load these
  // from node_modules at runtime instead.
  serverExternalPackages: [
    "jsdom",
    "parse5",
    "@mozilla/readability",
    "pdfjs-dist",
    "@circle-fin/unified-balance-kit",
    "@solana/web3.js",
    "@coral-xyz/anchor",
  ],
  outputFileTracingIncludes: {
    // Explicitly scoped metadata primitive is staged, not route-activated. Keep
    // its isolated parser available when a future typed adapter passes cutover.
    "/*": ["./lib/web-research/*-worker.mjs", "./lib/web-research/html-visibility.mjs", "./lib/research/arxiv-bibliography-worker.mjs", "./node_modules/@mozilla/readability/**", "./node_modules/pdfjs-dist/legacy/build/*.mjs", "./node_modules/pdfjs-dist/package.json"],
  },
};

export default nextConfig;
