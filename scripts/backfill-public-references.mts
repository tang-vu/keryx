import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { backfillPublicReference, parseBackfillArgs } from "../lib/public-references/backfill.ts";
import { APPROVED_PUBLIC_REFERENCES } from "../lib/public-references/approved-catalog.ts";
import type { KeryxDB } from "../lib/db/keryx-db.ts";
import type { SqliteAdapter as SqliteAdapterType } from "../lib/db/sqlite-adapter.ts";

async function main() {
  if (process.argv.slice(2).join(" ") === "--help") {
    console.log("Usage: node --import tsx scripts/backfill-public-references.mts --reference public:ID --checkpoint ABSOLUTE_JSON [--dry-run|--apply] [--max-documents 25] [--max-pages 20] [--duration-ms 60000] [--pace-ms 1000] [--database ABSOLUTE_SQLITE]\nLoad the operator environment explicitly. Default dry-run fetches discovery pages and retains article candidates in the checkpoint without database writes. --apply resumes the same queue and archives excerpts. --database is only an existing ordinary offline-testnet staging database. Production uses its configured enrolled SQLite profile and existing release/storage gates. Publisher robots and pacing are respected; exact robots404/410 absence permits crawling, while auth failures, redirects and unreachable robots retain work. Resume finite batches explicitly; no automatic scheduling, spending or access bypass.");
    return;
  }
  const options = parseBackfillArgs(process.argv.slice(2));
  const { config, hasSupabase } = await import("../lib/config.ts");
  const { ARC_TESTNET_PROFILE } = await import("../lib/arc-network-profile.ts");
  const { createReadonlyApplicationStorage, closeReadonlyApplicationStorage } = await import("../lib/db/application-storage.ts");
  const { SqliteAdapter } = await import("../lib/db/sqlite-adapter.ts");
  // An arbitrary path never overrides a production profile or a sealed deployment.
  if (options.databasePath && (config.profile !== ARC_TESTNET_PROFILE || process.env.KERYX_FORCE_OFFLINE !== "1" || process.env.KERYX_STORAGE_MANIFEST !== undefined || hasSupabase())) throw new Error("staging-profile-required");
  let databasePath = options.databasePath;
  let storeBinding: string;
  if (process.env.KERYX_STORAGE_MANIFEST !== undefined || config.profile !== ARC_TESTNET_PROFILE) {
    const { readRuntimeStorageDeployment } = await import("../lib/db/runtime-storage-config.ts");
    const deployment = readRuntimeStorageDeployment();
    if (deployment.backend.kind !== "sqlite") throw new Error("sqlite-profile-required");
    databasePath = deployment.backend.databasePath;
    storeBinding = createHash("sha256").update(JSON.stringify(deployment)).digest("hex");
  } else {
    if (hasSupabase()) throw new Error("sqlite-profile-required");
    databasePath ??= resolve("data/keryx.sqlite");
    storeBinding = createHash("sha256").update(JSON.stringify({ profile: config.profile.networkId, databasePath })).digest("hex");
  }
  if ([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].some(file => file.toLowerCase() === options.checkpointPath.toLowerCase())) throw new Error("checkpoint-database-collision");
  const admitted = await createReadonlyApplicationStorage();
  const reader = admitted ?? new SqliteAdapter(databasePath, { readOnly: true });
  let reference;
  try { reference = await reader.getPublicReference?.(options.referenceId); }
  finally { if (admitted) closeReadonlyApplicationStorage(admitted); else (reader as SqliteAdapterType).close(); }
  const approved = APPROVED_PUBLIC_REFERENCES.find(candidate => candidate.id === options.referenceId);
  if (!reference || !approved || approved.url !== reference.url || approved.rssUrl !== reference.rssUrl) throw new Error("approved-reference-unavailable");
  if (!reference.active) { console.log(JSON.stringify({ referenceId: reference.id, status: "inactive", documents: 0 })); return; }
  let close: () => void;
  let db: KeryxDB;
  if (options.apply) {
    if (options.databasePath) {
      const staging = new SqliteAdapter(databasePath);
      try { await staging.init(); } catch (error) { staging.close(); throw error; }
      db = staging; close = () => staging.close();
    } else {
      db = await (await import("../lib/db/index.ts")).getDb();
      close = () => { (db as { close?: () => void }).close?.(); };
    }
  } else {
    const selected = await createReadonlyApplicationStorage();
    db = selected ?? new SqliteAdapter(databasePath, { readOnly: true });
    close = selected ? () => closeReadonlyApplicationStorage(selected) : () => (db as SqliteAdapterType).close();
  }
  if (options.apply && !db.archivePublicReferenceItems) { close(); throw new Error("archive-write-unavailable"); }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try {
    const report = await backfillPublicReference(reference, { ...options, storeBinding, signal: controller.signal }, {
      loadReference: async () => await db.getPublicReference?.(options.referenceId) ?? null,
      ...(options.apply ? { archiveItems: db.archivePublicReferenceItems!.bind(db) } : {}) });
    console.log(JSON.stringify(report));
    // Interrupted and unresolved work is retained; it cannot masquerade as a finished archive.
    if (report.status === "cancelled") process.exitCode = 130;
    else if (report.status === "unsupported" || Object.keys(report.issues).length) process.exitCode = 2;
  } finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); close(); }
}

main().catch(error => {
  const code = error instanceof Error && /^[a-z]+(?:-[a-z]+)+$/u.test(error.message) ? error.message : "backfill-unavailable";
  console.error(JSON.stringify({ error: code, message: "Existing checkpoint and database retained; check source, profile and checkpoint ownership." }));
  process.exitCode = 1;
});
