import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { BUILD_MASKED_ENVIRONMENT, isolatedOfflineBuildEnvironment } from "./storage-build-environment";
const folders: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
it("masks all known secrets and selects only explicit offline storage", () => {
  const env = isolatedOfflineBuildEnvironment("/synthetic/manifest.json", "/synthetic/offline.sqlite",
    { PATH: "public-path", NODE_OPTIONS: "--max-old-space-size=1536", AGENT_FUNDER_PRIVATE_KEY: "private-marker",
      SUPABASE_SERVICE_ROLE_KEY: "private-marker", KERYX_STORAGE_MANIFEST: "/production/manifest.json", ARBITRARY_SECRET: "private-marker" });
  for (const name of BUILD_MASKED_ENVIRONMENT) expect(env[name]).toBe("");
  expect(env.KERYX_STORAGE_MANIFEST).toBe("/synthetic/manifest.json"); expect(env.KERYX_FORCE_OFFLINE).toBe("1");
  expect(env.ARBITRARY_SECRET).toBeUndefined(); expect(JSON.stringify(env)).not.toContain("private-marker");
});
it("does not allow inherited Node loaders or arbitrary flags", () => {
  expect(() => isolatedOfflineBuildEnvironment("manifest", "store", { NODE_OPTIONS: "--require private-loader.cjs" })).toThrow(/memory configuration/);
});
it("installed Next dotenv cannot reactivate known funders/credentials or replace fixture identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "keryx-build-env-")); folders.push(directory);
  writeFileSync(join(directory, ".env.local"), [...BUILD_MASKED_ENVIRONMENT.map(name => `${name}=private-marker`),
    "KERYX_STORAGE_MANIFEST=/production/manifest.json", "KERYX_SQLITE_PATH=/production/live.sqlite", "KERYX_FORCE_OFFLINE=0"].join("\n"));
  const env = isolatedOfflineBuildEnvironment("/synthetic/manifest.json", "/synthetic/offline.sqlite", {});
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value!);
  const { combinedEnv } = loadEnvConfig(directory, false, { info() {}, error() {} }, true);
  for (const name of BUILD_MASKED_ENVIRONMENT) expect(combinedEnv[name]).toBe("");
  expect(combinedEnv.KERYX_STORAGE_MANIFEST).toBe("/synthetic/manifest.json");
  expect(combinedEnv.KERYX_SQLITE_PATH).toBe("/synthetic/offline.sqlite"); expect(combinedEnv.KERYX_FORCE_OFFLINE).toBe("1");
});
