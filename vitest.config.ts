import { defineConfig } from "vitest/config";

// Unit tests for pure economic-invariant logic (the agent orchestrator). Node env, no Next runtime.
// External marketplace discovery is disabled so the orchestrator never shells out to the `circle`
// CLI during a test — the run graph stays hermetic (config, query-memory, citation-webhook only).
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    env: {
      KERYX_EXTERNAL_DISCOVERY: "0",
    },
  },
});
