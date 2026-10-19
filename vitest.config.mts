import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for pure economic-invariant logic (the agent orchestrator). Node env, no Next runtime.
// External marketplace discovery is disabled so the orchestrator never shells out to the `circle`
// CLI during a test — the run graph stays hermetic (config, query-memory, citation-webhook only).
export default defineConfig({
  // Mirrors the "@/*" alias from tsconfig, which app modules use freely. Without it, any test that
  // reaches a module importing "@/lib/..." fails to resolve at run time.
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts", "scripts/**/*.test.mts", "shared/sponsored-research-client.test.ts", "cloudflare/source-upkeep/src/*.test.ts", "lib/research/evidence-draft-editor.test.tsx", "app/api/account/membership/route.test.ts"],
    // Native SQLite fixtures include child startup, module loading and guarded DB operations;
    // their cumulative duration can exceed 10s on virtualized Linux as well as Windows.
    // Keep bounded 20s test/hook deadlines; CI/Linux stays parallel and Windows uses one worker.
    maxWorkers: process.platform === "win32" ? 1 : undefined,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      KERYX_EXTERNAL_DISCOVERY: "0",
    },
  },
});
