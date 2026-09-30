import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { provisionSyntheticStorage, syntheticStorageIdentity } from "../lib/db/storage-identity-fixture";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { canonicalJson } from "../lib/canonical-json";
import { isolatedOfflineBuildEnvironment } from "./storage-build-environment";

it("admits a keyless real synthetic store read-only and refuses foreign identity without initialization", async () => {
  const directory = mkdtempSync(join(tmpdir(), "keryx-storage-preflight-"));
  try {
    const file = join(directory, "source.sqlite"), manifest = join(directory, "manifest.json");
    const identity = await provisionSyntheticStorage(file, "testnet-real");
    vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
    const db = new SqliteAdapter(file, { expectedIdentity: identity }); try { await db.init(); } finally { db.close(); }
    const before = readFileSync(file);
    const env = isolatedOfflineBuildEnvironment(manifest, file, process.env); env.KERYX_FORCE_OFFLINE = "0";
    const run = () => spawnSync(process.execPath, ["--import", "tsx", "--no-warnings", "scripts/preflight-storage.mts"],
      { env, encoding: "utf8", timeout: 15000, windowsHide: true });
    const save = (expected = identity) => writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1",
      identity: expected, backend: { kind: "sqlite", databasePath: file } }));
    save(); const accepted = run(); expect(accepted.status, accepted.stderr).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({ authorityMode: "testnet-real", readOnly: true, signingResumeAuthorized: false, runtimeReady: false });
    save(syntheticStorageIdentity("testnet-real")); const foreign = run(); expect(foreign.status).toBe(1);
    expect(foreign.stdout).toBe(""); expect(foreign.stderr).not.toContain(file); expect(readFileSync(file)).toEqual(before);
  } finally { vi.unstubAllEnvs(); rmSync(directory, { recursive: true }); }
});
