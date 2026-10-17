import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { installPublicReferenceArchive } from "./public-reference-archive";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { GATEWAY_FUNDING_SCHEMA, GATEWAY_FUNDING_INDEXES } from "./gateway-funding-sqlite-schema";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, installStorageFences,
  STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";
import { STORAGE_SNAPSHOT_LIMITS as limits, encodeStorageValue } from "./storage-identity-snapshot";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";

export const PUBLIC_ARCHIVE_TABLES = Object.freeze(["public_reference_articles", "public_reference_article_versions", "public_reference_article_terms"]);
// Other migration callers retain the standard bounds, including 64 MiB framing.
export const MIGRATION_FRAMED_BYTE_LIMIT = 64 * 1024 * 1024;
// Only the exact public-archive profiles use these operation bounds. Enrollment,
// generic backup/provenance and other domain migrations keep their own limits.
export const PUBLIC_ARCHIVE_SNAPSHOT_LIMITS = Object.freeze({ ...limits,
  fileBytes: 256 * 1024 * 1024, rows: 500_000, totalBytes: 192 * 1024 * 1024, framedBytes: 192 * 1024 * 1024 });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
function excluded(db: DatabaseSync, identity: StorageIdentity): Set<string> {
  return new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
    "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db, identity))]);
}

/** Exact source pairs preserve base/full-native mainnet schema and optional testnet funding tables. */
export function publicReferenceArchiveMigrationProfiles(mainnet = false): readonly (readonly [string, string])[] {
  const references = mainnet
    ? [{ funding: false, nativeUserDomains: false }, { funding: false, nativeUserDomains: true }]
    : [{ funding: false, nativeUserDomains: false }, { funding: true, nativeUserDomains: false }];
  return references.map(({ funding, nativeUserDomains }) => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("BEGIN");
      if (mainnet) installMainnetApplicationSchema(db, { publicReferenceArchive: false });
      else installSqliteApplicationSchema(db, { publicReferenceArchive: false });
      if (nativeUserDomains) installNativeUserDomainSchema(db);
      if (funding) {
        for (const sql of Object.values(GATEWAY_FUNDING_SCHEMA)) db.exec(sql);
        for (const sql of Object.values(GATEWAY_FUNDING_INDEXES)) db.exec(sql);
      }
      const before = sqliteApplicationSchemaProfile(db, new Set());
      installPublicReferenceArchive(db);
      const pair = [before, sqliteApplicationSchemaProfile(db, new Set())] as const;
      db.exec("ROLLBACK");
      return pair;
    } finally { db.close(); }
  });
}

export interface PublicArchiveStorageSnapshot {
  format: "keryx-public-archive-storage-snapshot-v1";
  schemaDigest: string;
  rows: number;
  tables: Record<string, { rows: number; digest: string }>;
}
/** Bounded exact typed row hashes, including rowids and raw TEXT bytes. Never decrypts originals.
 * This is migration/backup evidence only; no runtime storage-reader capability is issued. */
export function snapshotPublicArchiveStorage(db: DatabaseSync, identity: StorageIdentity,
  profiles: readonly string[]): PublicArchiveStorageSnapshot {
  return snapshotStorage(db, identity, profiles, { ...limits, framedBytes: MIGRATION_FRAMED_BYTE_LIMIT });
}
/** Fixed archive-only resource allowance; callers cannot supply numeric overrides
 * or admit a schema outside the source-built archive pairs. */
export function snapshotPublicArchiveMigrationStorage(db: DatabaseSync, identity: StorageIdentity,
  profiles: readonly string[]): PublicArchiveStorageSnapshot {
  const accepted = publicReferenceArchiveMigrationProfiles(identity.authorityMode === "mainnet-real").flat();
  if (!profiles.length || profiles.some(profile => !accepted.includes(profile))) throw new Error("Public archive migration profiles refused");
  return snapshotStorage(db, identity, profiles, PUBLIC_ARCHIVE_SNAPSHOT_LIMITS);
}
function snapshotStorage(db: DatabaseSync, identity: StorageIdentity, profiles: readonly string[],
  bounds: Readonly<{ fileBytes: number; rows: number; totalBytes: number; framedBytes: number; deadlineMs: number }>): PublicArchiveStorageSnapshot {
  assertStorageIdentity(db, identity); assertStorageFences(db, identity);
  const profile = sqliteApplicationSchemaProfile(db, excluded(db, identity));
  if (!profiles.includes(profile) || db.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok"
    || db.prepare("PRAGMA foreign_key_check").get()) throw new Error("Public archive migration snapshot refused");
  // Includes pages allocated by the uncommitted archive; refuse before COMMIT,
  // rather than discovering an oversized accepted target in the postflight.
  const pages = Number(db.prepare("PRAGMA page_count").get()!.page_count), pageSize = Number(db.prepare("PRAGMA page_size").get()!.page_size);
  if (!Number.isSafeInteger(pages * pageSize) || pages * pageSize > bounds.fileBytes) throw new Error("Public archive migration file limit");
  const tables: PublicArchiveStorageSnapshot["tables"] = {}, deadline = Date.now() + bounds.deadlineMs;
  let rows = 0, bytes = 0, framedBytes = 0;
  const schema = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name LIMIT ?").all(limits.schemaObjects + 1);
  if (schema.length > limits.schemaObjects) throw new Error("Public archive migration schema limit");
  for (const table of schema) {
    if (Date.now() > deadline || typeof table.name !== "string" || typeof table.sql !== "string") throw new Error("Public archive migration snapshot limit");
    const columns = db.prepare(`PRAGMA table_info(${quote(table.name)})`).all().map(row => String(row.name));
    if (columns.length > limits.columns) throw new Error("Public archive migration column limit");
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
    // Stream each bounded field; only fixed-size row hashes are retained for sorting.
    for (const row of statement.iterate(bounds.rows + 1)) {
      if (++rows > bounds.rows || Date.now() > deadline) throw new Error("Public archive migration row/deadline limit");
      const hash = createHash("sha256");
      for (let index = 0; index < columns.length; index++) {
        const length = Number(row[`l${index}`] ?? 0);
        if (length > limits.fieldBytes || (bytes += length) > bounds.totalBytes) throw new Error("Public archive migration byte limit");
        const type = String(row[`t${index}`]), value = row[`v${index}`];
        // Binary length framing preserves malformed UTF-8 without a lossy decode or hex expansion.
        const payload = type === "text" ? value as Uint8Array : Buffer.from(encodeStorageValue(value, type));
        if (!(payload instanceof Uint8Array)) throw new Error("Public archive migration typed value refused");
        const prefix = `${type}:${payload.byteLength}:`;
        framedBytes += Buffer.byteLength(prefix) + payload.byteLength;
        if (framedBytes > bounds.framedBytes) throw new Error("Public archive migration framed byte limit");
        hash.update(prefix); hash.update(payload);
      }
      hashes.push(hash.digest("hex"));
    }
    // Same canonical bytes as {columns,rows:sortedHashes}, without constructing a
    // second table-sized JSON string. Never retain complete encoded originals.
    const digest = createHash("sha256").update(`{"columns":${canonicalJson(columns)},"rows":[`);
    hashes.sort().forEach((hash, index) => digest.update(`${index ? "," : ""}"${hash}"`));
    tables[table.name] = { rows: hashes.length, digest: digest.update("]}").digest("hex") };
  }
  return { format: "keryx-public-archive-storage-snapshot-v1", schemaDigest: sha(profile), rows, tables };
}

/** Explicit stopped-writer DDL. The mandatory callback binds a flushed no-replace verified
 * backup and exact manifest under this EXCLUSIVE transaction; it cannot mutate source rows.
 * Existing roles, identity, fences, financial originals and publication authority are retained. */
export function migratePublicReferenceArchiveStorage(file: string, value: StorageIdentity,
  beforeMigrate: (db: DatabaseSync) => void) {
  const identity = validateStorageIdentity(value);
  if (typeof beforeMigrate !== "function") throw new Error("Public archive migration backup admission required");
  const pairs = publicReferenceArchiveMigrationProfiles(identity.authorityMode === "mainnet-real"), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { allowExtension: false });
    db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    const before = sqliteApplicationSchemaProfile(db, excluded(db, identity));
    const pair = pairs.find(([previous, current]) => before === previous || before === current);
    if (!pair) throw new Error("Public archive migration source profile differs");
    const originals = snapshotPublicArchiveMigrationStorage(db, identity, pair);
    const changes = db.prepare("SELECT total_changes() AS n").get()!.n;
    beforeMigrate(db);
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    if (sqliteApplicationSchemaProfile(db, excluded(db, identity)) !== before || db.prepare("SELECT total_changes() AS n").get()!.n !== changes)
      throw new Error("Public archive migration admission changed");
    if (before === pair[0]) { installPublicReferenceArchive(db); installStorageFences(db, identity); }
    assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
    const after = snapshotPublicArchiveMigrationStorage(db, identity, [pair[1]]), retained = { ...after.tables };
    for (const table of PUBLIC_ARCHIVE_TABLES) if (!(table in originals.tables)) delete retained[table];
    if (canonicalJson(retained) !== canonicalJson(originals.tables)) throw new Error("Public archive migration original rows differ");
    db.exec("COMMIT");
    return { format: "keryx-public-reference-archive-storage-migration-v1", status: before === pair[1] ? "already-current" : "migrated",
      beforeSchemaDigest: originals.schemaDigest, afterSchemaDigest: after.schemaDigest,
      originalRowsPreserved: true, signingResumeAuthorized: false };
  } catch (error) { try { db?.exec("ROLLBACK"); } catch { /* Keep the original error and stopped-writer evidence. */ } throw error; }
  finally { try { db?.close(); } finally { held.close(); } }
}
