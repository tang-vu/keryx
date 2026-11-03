/** Explicit operator entry point, not application startup. stdout contains a
 * PRIVATE public-data snapshot; stderr emits fixed, content-free status only. */
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../../../lib/canonical-json";
import { readRuntimeStorageDeployment } from "../../../lib/db/runtime-storage-config";
import { openVerifiedSqliteStorage } from "../../../lib/db/storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "../../../lib/db/enrolled-sqlite-schema-profile";
import { exportPublicCatalog, sha256, PublicCatalogExportError } from "./public-catalog-export";

let connection: ReturnType<typeof openVerifiedSqliteStorage> | undefined;
try {
  if (process.argv.slice(2).join(" ") !== "--export-selected-public-catalog" || process.platform !== "linux") throw new Error("refused");
  // Verify the actual cgroup before opening the selected private datastore.
  // The operator also records a separate native-pressure/OOM enforcement probe
  // using this same transient-unit MemoryMax/MemorySwapMax configuration.
  const group = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n");
  if (group.length !== 1 || !/^0::\/[a-zA-Z0-9_.\/-]+$/.test(group[0])) throw new Error("refused");
  const path = group[0].slice(3);
  if (path.split("/").includes("..")) throw new Error("refused");
  const limit = readFileSync("/sys/fs/cgroup" + path + "/memory.max", "utf8").trim();
  const swap = readFileSync("/sys/fs/cgroup" + path + "/memory.swap.max", "utf8").trim();
  if (!/^\d+$/.test(limit) || BigInt(limit) > BigInt(512 * 1024 * 1024) || BigInt(limit) < BigInt(128 * 1024 * 1024) || swap !== "0") throw new Error("refused");
  console.error(JSON.stringify({ phase: "contained-public-export", pid: process.pid, memoryMaxBytes: limit, swapMaxBytes: swap, privateStoreOpened: false }));
  const selected = readRuntimeStorageDeployment(), pinned = canonicalJson(selected);
  if (selected.identity.authorityMode !== "mainnet-real" || selected.backend.kind !== "sqlite") throw new Error("refused");
  const runtimeGuard = () => { if (canonicalJson(readRuntimeStorageDeployment()) !== pinned) throw new Error("refused"); };
  connection = openVerifiedSqliteStorage(selected.backend.databasePath, selected.identity,
    { readOnly: true, runtimeGuard, applicationProfiles: supportedSqliteApplicationProfiles(true) });
  console.error(JSON.stringify({ phase: "selected-public-export-readonly-admitted", pid: process.pid }));
  await exportPublicCatalog(connection.db, async record => {
    if (!process.stdout.write(canonicalJson(record) + "\n")) await once(process.stdout, "drain");
  }, sha256(canonicalJson(selected.identity)));
  console.error(JSON.stringify({ accepted: true, publicDataOnly: true, productionMutation: false, memoryMaxBytes: limit, swapMaxBytes: swap }));
} catch (error) {
  // Never print stored text, manifest details, environment values or SQL errors.
  console.error(JSON.stringify({ accepted: false, code: error instanceof PublicCatalogExportError ? error.code : "selected_public_export_refused", productionMutation: false })); process.exitCode = 1;
} finally {
  try { connection?.close(); } catch { console.error(JSON.stringify({ accepted: false, code: "selected_public_export_cleanup_refused" })); process.exitCode = 1; }
}
