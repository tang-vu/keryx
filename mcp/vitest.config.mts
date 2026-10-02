import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["mcp/**/*.test.mts"],
  maxWorkers: process.platform === "win32" ? 1 : undefined,
  testTimeout: process.platform === "win32" ? 20_000 : 10_000,
} });

