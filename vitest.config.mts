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
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    // SQLite's synchronous file locks and Windows antivirus make the DB-heavy suite exceed the
    // generic 5s default under parallel workers. CI/Linux stays parallel; local Windows runs one
    // worker with bounded 20s test/hook deadlines so timing noise cannot masquerade as regression.
    maxWorkers: process.platform === "win32" ? 1 : undefined,
    testTimeout: process.platform === "win32" ? 20_000 : 10_000,
    hookTimeout: process.platform === "win32" ? 20_000 : 10_000,
    env: {
      KERYX_EXTERNAL_DISCOVERY: "0",
    },
  },
});
