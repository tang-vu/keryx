import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../lib/canonical-json";
import { provisionSyntheticStorage } from "../lib/db/storage-identity-fixture";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { isolatedOfflineBuildEnvironment } from "./storage-build-environment";

/** Explicit fresh offline storage for a local build/server harness; never enroll or open an inherited target. */
export async function offlineRuntimeFixture(inherited: Readonly<Record<string, string | undefined>>) {
  const directory = await mkdtemp(join(tmpdir(), "keryx-offline-runtime-"));
  try {
    const databasePath = join(directory, "offline.sqlite"), manifestPath = join(directory, "manifest.json");
    const identity = await provisionSyntheticStorage(databasePath, "testnet-offline");
    const adapter = new SqliteAdapter(databasePath, { expectedIdentity: identity });
    try { await adapter.init(); } finally { adapter.close(); }
    await writeFile(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
      backend: { kind: "sqlite", databasePath } }) + "\n", { flag: "wx", mode: 0o600 });
    return { env: isolatedOfflineBuildEnvironment(manifestPath, databasePath, inherited),
      close: () => rm(directory, { recursive: true, force: true }) };
  } catch { await rm(directory, { recursive: true, force: true }); throw new Error("Synthetic offline storage unavailable"); }
}
