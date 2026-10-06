import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../lib/canonical-json";
import { inspectStorageDeploymentManifest } from "../lib/db/runtime-storage-config";
import { storageIdentityDigest, type StorageIdentity } from "../lib/db/storage-identity";
import { assertStorageCreationParent, assertStorageFences, assertStorageIdentity, holdStorageTarget,
  STORAGE_IDENTITY_TABLE, storageFenceStatements } from "../lib/db/storage-identity-sqlite";
import { encodeStorageValue, STORAGE_SNAPSHOT_LIMITS as limits } from "../lib/db/storage-identity-snapshot";
import { installMainnetApplicationSchema } from "../lib/db/mainnet-application-schema";
import { sqliteApplicationSchemaProfile } from "../lib/db/sqlite-application-schema-profile";
import { migrateSessionWithdrawalAbortStorage } from "../lib/db/session-withdrawal-abort-migration";
import { originalFulfillmentSchemaProfiles, migrateFailedOriginalFulfillmentStorage } from "../lib/db/a2a-fulfillment-migration";

function fail(): never { throw new Error("Economic storage migration refused; retain all original and backup evidence"); }
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const digestPattern = /^[a-f0-9]{64}$/;
type MigrationKind = "economic" | "original-fulfillment";
const migrationFormat = (kind: MigrationKind) => kind === "economic" ? "keryx-economic-storage-migration-v1" : "keryx-original-fulfillment-storage-migration-v1";
type Snapshot = { schemaDigest: string; rows: number; tables: Record<string, { rows: number; digest: string }> };

function schemaProfile(db: DatabaseSync, identity: StorageIdentity): string {
  return sqliteApplicationSchemaProfile(db, new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update",
    "storage_identity_no_delete", "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db, identity))]));
}
function approvedProfiles(kind: MigrationKind = "economic"): readonly string[] {
  if (kind === "original-fulfillment") return originalFulfillmentSchemaProfiles();
  return [false, true].map(publicationAbort => {
    const db = new DatabaseSync(":memory:");
    try { installMainnetApplicationSchema(db, { publicationAbort }); return sqliteApplicationSchemaProfile(db, new Set()); }
    finally { db.close(); }
  });
}

/** Backup verification, not enrollment: preserve any retained mainnet evidence.
 * Typed row hashes include rowid and every column; only digests leave this process. */
function snapshot(db: DatabaseSync, identity: StorageIdentity, profiles: readonly string[]): Snapshot {
  assertStorageIdentity(db, identity); assertStorageFences(db, identity);
  const profile = schemaProfile(db, identity);
  if (!profiles.includes(profile) || db.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").get()) fail();
  const deadline = Date.now() + limits.deadlineMs, tables: Snapshot["tables"] = {};
  let rows = 0, bytes = 0;
  for (const table of db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name").all()) {
    if (Date.now() > deadline || typeof table.name !== "string" || typeof table.sql !== "string") fail();
    const columns = db.prepare(`PRAGMA table_info(${quote(table.name)})`).all().map(row => String(row.name));
    const rowid = !/\bWITHOUT\s+ROWID\b/i.test(table.sql)
      ? ["_rowid_", "rowid", "oid"].find(name => !columns.some(column => column.toLowerCase() === name)) : undefined;
    if (rowid) columns.unshift(rowid);
    const projections = columns.flatMap((name, index) => [
      `typeof(${quote(name)}) AS t${index}`, `length(CAST(${quote(name)} AS BLOB)) AS l${index}`,
      `CASE WHEN length(CAST(${quote(name)} AS BLOB))<=${limits.fieldBytes} THEN CASE WHEN typeof(${quote(name)})='text' THEN CAST(${quote(name)} AS BLOB) ELSE ${quote(name)} END ELSE NULL END AS v${index}`,
    ]);
    const statement = db.prepare(`SELECT ${projections.join(",")} FROM ${quote(table.name)} LIMIT ?`);
    statement.setReadBigInts(true);
    const hashes: string[] = [];
    for (const row of statement.iterate(limits.rows + 1)) {
      if (++rows > limits.rows || Date.now() > deadline) fail();
      const fields = columns.map((_name, index) => {
        const length = Number(row[`l${index}`] ?? 0);
        if (length > limits.fieldBytes || (bytes += length) > limits.totalBytes) fail();
        const type = String(row[`t${index}`]);
        // Hash raw SQLite TEXT bytes, including malformed UTF-8, without lossy decoding.
        return type === "text" ? JSON.stringify(["text-bytes", encodeStorageValue(row[`v${index}`], "blob")])
          : encodeStorageValue(row[`v${index}`], type);
      });
      hashes.push(sha(JSON.stringify(fields)));
    }
    tables[table.name] = { rows: hashes.length, digest: sha(canonicalJson({ columns, rows: hashes.sort() })) };
  }
  return { schemaDigest: sha(profile), rows, tables };
}

function openSnapshot(file: string, identity: StorageIdentity, profiles: readonly string[]) {
  const held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    if (fstatSync(held.descriptor).size > limits.fileBytes) fail();
    db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
    db.exec("PRAGMA busy_timeout=1000; BEGIN");
    held.verify();
    const value = snapshot(db, identity, profiles);
    held.verify();
    return { db, held, value, close: () => { try { db!.close(); } finally { held.close(); } } };
  } catch (error) { try { db?.close(); } finally { held.close(); } throw error; }
}
function freshFile(file: string): number {
  assertStorageCreationParent(file);
  return openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
}
function syncDirectory(file: string) {
  if (process.platform === "win32") return; // Windows disallows directory fsync; files are still flushed.
  const fd = openSync(dirname(file), constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export interface EconomicMigrationOptions {
  manifest: string;
  expectedManifestDigest: string;
  expectedIdentityDigest: string;
  backup: string;
  receipt: string;
  writersStopped: boolean;
}

/** Explicit read-only inventory. Never loads env files, adopts identity, or opens custody. */
function inspectBoundStorage(manifestFile: string, kind: MigrationKind) {
  const manifest = inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifestFile });
  if (manifest.backend.kind !== "sqlite" || manifest.identity.authorityMode !== "mainnet-real") fail();
  const source = openSnapshot(manifest.backend.databasePath, manifest.identity, approvedProfiles(kind));
  try {
    return { format: kind === "economic" ? "keryx-economic-storage-inspection-v1" : "keryx-original-fulfillment-storage-inspection-v1", manifestDigest: sha(canonicalJson(manifest)),
      identityDigest: storageIdentityDigest(manifest.identity), targetDigest: source.held.identity,
      schemaDigest: source.value.schemaDigest, snapshotDigest: sha(canonicalJson(source.value)),
      rows: source.value.rows, signingResumeAuthorized: false };
  } finally { source.close(); }
}
export function inspectEconomicStorage(manifestFile: string) { return inspectBoundStorage(manifestFile, "economic"); }
export function inspectOriginalFulfillmentStorage(manifestFile: string) { return inspectBoundStorage(manifestFile, "original-fulfillment"); }

/** Operator must stop and verify every writer before calling. BEGIN EXCLUSIVE in
 * the migration refuses an occupied database; this flag is not process discovery. */
async function migrateBoundStorage(options: EconomicMigrationOptions, kind: MigrationKind) {
  if (options.writersStopped !== true || !digestPattern.test(options.expectedManifestDigest) ||
      !digestPattern.test(options.expectedIdentityDigest)) fail();
  const manifest = inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: options.manifest });
  if (manifest.backend.kind !== "sqlite" || manifest.identity.authorityMode !== "mainnet-real" ||
      sha(canonicalJson(manifest)) !== options.expectedManifestDigest ||
      storageIdentityDigest(manifest.identity) !== options.expectedIdentityDigest) fail();
  const recheckManifest = () => {
    if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: options.manifest })) !== canonicalJson(manifest)) fail();
  };
  const profiles = approvedProfiles(kind), file = manifest.backend.databasePath;
  const addedTables = kind === "economic" ? ["session_withdrawal_publication_aborts"] :
    ["a2a_failed_original_fulfillments", "a2a_fulfillment_completions"];
  const source = openSnapshot(file, manifest.identity, profiles);
  let receiptFd: number | undefined, outputFd: number | undefined;
  let outputHeld: ReturnType<typeof holdStorageTarget> | undefined;
  let sourceClosed = false;
  const append = (record: unknown) => {
    const bytes = Buffer.from(canonicalJson(record) + "\n");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(receiptFd!, bytes, offset, bytes.length - offset);
    fsyncSync(receiptFd!); syncDirectory(options.receipt);
  };
  try {
    // Never overwrite backups/receipts, including incomplete earlier attempts.
    receiptFd = freshFile(options.receipt);
    outputFd = freshFile(options.backup); outputHeld = holdStorageTarget(options.backup);
    const created = fstatSync(outputFd, { bigint: true }), held = fstatSync(outputHeld.descriptor, { bigint: true });
    if (created.dev !== held.dev || created.ino !== held.ino || created.birthtimeNs !== held.birthtimeNs) fail();
    await backup(source.db, options.backup, { rate: 100, progress: () => {
      source.held.verify(); outputHeld!.verify();
      if (fstatSync(outputFd!).size > limits.fileBytes) fail();
    } });
    outputHeld.verify(); source.held.verify(); fsyncSync(outputFd); syncDirectory(options.backup);
    const copied = openSnapshot(options.backup, manifest.identity, profiles);
    try { if (canonicalJson(copied.value) !== canonicalJson(source.value)) fail(); } finally { copied.close(); }
    recheckManifest();
    append({ format: migrationFormat(kind), phase: "backup-verified",
      manifestDigest: options.expectedManifestDigest, identityDigest: options.expectedIdentityDigest,
      sourceTargetDigest: source.held.identity, backupTargetDigest: outputHeld.identity,
      beforeSchemaDigest: source.value.schemaDigest, beforeSnapshotDigest: sha(canonicalJson(source.value)),
      rows: source.value.rows, signingResumeAuthorized: false });
    source.close(); sourceClosed = true;
    // Recheck the backed-up snapshot under the migration's EXCLUSIVE lock. A
    // racing old writer must never leave upgraded history absent from the backup.
    const migrationTarget = holdStorageTarget(file);
    let migration: ReturnType<typeof migrateSessionWithdrawalAbortStorage> | ReturnType<typeof migrateFailedOriginalFulfillmentStorage>;
    try {
      if (migrationTarget.identity !== source.held.identity) fail();
      const migrate = kind === "economic" ? migrateSessionWithdrawalAbortStorage : migrateFailedOriginalFulfillmentStorage;
      migration = migrate(file, manifest.identity, db => {
        migrationTarget.verify(); recheckManifest(); outputHeld!.verify();
        if (canonicalJson(snapshot(db, manifest.identity, profiles)) !== canonicalJson(source.value)) fail();
        const retainedBackup = openSnapshot(options.backup, manifest.identity, profiles);
        try { if (canonicalJson(retainedBackup.value) !== canonicalJson(source.value)) fail(); }
        finally { retainedBackup.close(); }
      });
    } finally { migrationTarget.close(); }
    const after = openSnapshot(file, manifest.identity, [profiles[1]]);
    try {
      const retained = { ...after.value.tables };
      for (const added of addedTables) if (!(added in source.value.tables)) {
        if (retained[added]?.rows !== 0) fail();
        delete retained[added];
      }
      if (canonicalJson(retained) !== canonicalJson(source.value.tables)) fail();
      recheckManifest(); outputHeld.verify();
      const result = { ...migration, format: migrationFormat(kind), phase: "migration-verified",
        manifestDigest: options.expectedManifestDigest, identityDigest: options.expectedIdentityDigest,
        originalRowsPreserved: true, beforeSnapshotDigest: sha(canonicalJson(source.value)),
        afterSnapshotDigest: sha(canonicalJson(after.value)), rows: after.value.rows,
        signingResumeAuthorized: false };
      append(result);
      return result;
    } finally { after.close(); }
  } finally {
    try { if (!sourceClosed) source.close(); } finally {
      try { outputHeld?.close(); } finally {
        try { if (outputFd !== undefined) closeSync(outputFd); } finally { if (receiptFd !== undefined) closeSync(receiptFd); }
      }
    }
  }
}
export async function migrateEconomicStorage(options: EconomicMigrationOptions) { return migrateBoundStorage(options, "economic"); }
export async function migrateOriginalFulfillmentStorage(options: EconomicMigrationOptions) { return migrateBoundStorage(options, "original-fulfillment"); }

export async function runEconomicStorageCli(args: string[]) {
  if (args.length === 3 && args[0] === "inspect" && args[1] === "--manifest") return inspectEconomicStorage(args[2]);
  const names = ["--manifest", "--expected-manifest", "--expected-identity", "--backup", "--receipt"];
  if (args.length !== 12 || args[0] !== "migrate" || args[11] !== "--writers-stopped" ||
      names.some((name, index) => args[index * 2 + 1] !== name)) fail();
  return migrateEconomicStorage({ manifest: args[2], expectedManifestDigest: args[4], expectedIdentityDigest: args[6],
    backup: args[8], receipt: args[10], writersStopped: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runEconomicStorageCli(process.argv.slice(2)))); }
  catch { console.error("Economic storage migration refused or acknowledgement incomplete; keep writers stopped and preserve all evidence."); process.exitCode = 1; }
}
