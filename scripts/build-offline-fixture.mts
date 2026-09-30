import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { canonicalJson } from "../lib/canonical-json.ts";
import { provisionSyntheticStorage } from "../lib/db/storage-identity-fixture.ts";
import { SqliteAdapter } from "../lib/db/sqlite-adapter.ts";
import { isolatedOfflineBuildEnvironment } from "./storage-build-environment.ts";

// Build-only explicit fresh offline storage. No real enrollment, key loading, or production store initialization.
const directory = await mkdtemp(join(tmpdir(), "keryx-build-storage-"));
try {
  const databasePath = join(directory, "offline.sqlite"), manifestPath = join(directory, "manifest.json");
  const identity = await provisionSyntheticStorage(databasePath, "testnet-offline");
  const adapter = new SqliteAdapter(databasePath, { expectedIdentity: identity });
  try { await adapter.init(); } finally { adapter.close(); }
  await writeFile(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath } }) + "\n", { flag: "wx", mode: 0o600 });
  const require = createRequire(import.meta.url);
  const env = isolatedOfflineBuildEnvironment(manifestPath, databasePath, process.env);
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "build", ...process.argv.slice(2)],
    { env, stdio: "inherit", windowsHide: true });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject); child.once("close", code => resolve(code ?? 1));
    });
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
} catch { console.error("Isolated offline build unavailable; production storage untouched"); process.exitCode = 1; }
finally { await rm(directory, { recursive: true, force: true }); }
