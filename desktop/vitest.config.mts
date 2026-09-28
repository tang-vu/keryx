import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"],
  maxWorkers: process.platform === "win32" ? 1 : undefined, testTimeout: 20_000 } });
