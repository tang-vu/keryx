import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { installNativeUserDomainSchema, NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, insertStorageIdentity, installStorageFences, registerStorageCapability,
  STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { publicReferenceItemId, type PublicReference } from "../public-references/catalog";
import { hasPublicReferenceArchive } from "./public-reference-archive";
import { migratePublicReferenceArchiveStorage, publicReferenceArchiveMigrationProfiles,
  snapshotPublicArchiveStorage, MIGRATION_FRAMED_BYTE_LIMIT } from "./public-reference-archive-migration";
import { scanFullStorageSnapshot, STORAGE_SNAPSHOT_LIMITS } from "./storage-identity-snapshot";
import { inspectPublicArchiveStorage, migratePublicArchiveStorage, runPublicArchiveStorageCli } from "../../scripts/source-archive-storage-migrate.mjs";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const reference: PublicReference = { id: "public:migration-test", name: "Original public publisher", url: "https://archive.test/",
  rssUrl: "https://archive.test/feed", description: "Original feed", tags: ["archive"], active: true, refreshedAt: "2026-10-01T00:00:00.000Z",
  items: [1, 2, 3].map(n => ({ id: publicReferenceItemId("public:migration-test", `https://archive.test/${n}`),
    link: `https://archive.test/${n}`, title: `Original article ${n}`, content: `Retained historical public body ${n}`,
    summary: "Public article", deliveryKind: "excerpt" })) };
function fixture(mainnet = true, invalid = false, nativeUserDomains = false) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-public-archive-migration-")); directories.push(directory);
  const file = join(directory, "store.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = mainnet ? { ...syntheticStorageIdentity("testnet-offline"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST } : syntheticStorageIdentity("testnet-offline");
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE");
    if (mainnet) installMainnetApplicationSchema(db); else installSqliteApplicationSchema(db);
    if (nativeUserDomains) {
      installNativeUserDomainSchema(db);
      const wallet = `0x${"1".repeat(40)}`;
      db.prepare("INSERT INTO private_profiles(wallet,handle,display_name,bio,purpose,links,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(wallet, null, "Synthetic retained owner", "Retained native note ☃", "research", "[]", reference.refreshedAt!, reference.refreshedAt!);
      db.prepare("INSERT INTO private_bibliographies VALUES(?,?,?,?,?,?,?,?,?)")
        .run("synthetic-native-bib", wallet, "1".repeat(64), "Original native bibliography", "@misc{synthetic,\n title={Original}}\n", 0, 1,
          reference.refreshedAt!, reference.refreshedAt!);
      db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)")
        .run("synthetic-typed-original", new Uint8Array([0, 255, 128]), null);
    }
    const snapshot = invalid ? { ...reference, items: [reference.items[0], { ...reference.items[1], id: reference.items[2]!.id }] } : reference;
    db.prepare("INSERT INTO public_references(id,active,rss_url,snapshot) VALUES (?,?,?,?)")
      .run(reference.id, 1, reference.rssUrl, JSON.stringify(snapshot));
    db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES (?,?,?)").run("retained-original", "Unchanged historical metadata", reference.refreshedAt!);
    // Explicit synthetic pending/simulated history, never represented as real settlement.
    db.prepare(`INSERT INTO payment_events(id,network,settled,settlement_status,amount_usdc,kind,source_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run("synthetic-retained-payment", identity.network, 0, mainnet ? "pending" : "simulated", 0.001, "fetch", "synthetic-source", reference.refreshedAt!);
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  return { directory, file, manifest, identity };
}
function profile(file: string, identity: StorageIdentity): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return sqliteApplicationSchemaProfile(db, new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
    "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db, identity))])); }
  finally { db.close(); }
}
function largeMetadata(f: ReturnType<typeof fixture>, value: string | Uint8Array) {
  const db = new DatabaseSync(f.file);
  try {
    registerStorageCapability(db, f.identity, () => true);
    db.exec("BEGIN IMMEDIATE");
    const insert = db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES (?,?,?)");
    for (let index = 0; index < 33; index++) insert.run(`large-original-${index}`, value, reference.refreshedAt!);
    db.exec("COMMIT");
  } finally { db.close(); }
  expect(statSync(f.file).size).toBeLessThan(STORAGE_SNAPSHOT_LIMITS.fileBytes);
}

describe("explicit public archive storage activation", () => {
  it("pairs only the exact supported base and full-native mainnet schemas across archive activation", () => {
    const pairs = publicReferenceArchiveMigrationProfiles(true);
    expect(NATIVE_USER_DOMAIN_TABLES).toHaveLength(25);
    expect(pairs).toHaveLength(2);
    expect(pairs.flat().sort()).toEqual([...supportedSqliteApplicationProfiles(true)].sort());
  });

  it("backs up and preserves populated native25 originals, fences and original fulfillment through activation and repeat", async () => {
    const f = fixture(true, false, true), beforeProfile = profile(f.file, f.identity);
    const pair = publicReferenceArchiveMigrationProfiles(true).find(([before]) => before === beforeProfile)!;
    expect(pair).toBeDefined();
    const beforeDb = new DatabaseSync(f.file, { readOnly: true });
    let before;
    try { before = snapshotPublicArchiveStorage(beforeDb, f.identity, [pair[0]]); }
    finally { beforeDb.close(); }
    const inspected = inspectPublicArchiveStorage(f.manifest), backup = join(f.directory, "native25-before.sqlite");
    expect(inspected.schemaDigest).toBe(createHash("sha256").update(pair[0]).digest("hex"));
    expect(await migratePublicArchiveStorage({ manifest: f.manifest, expectedManifestDigest: inspected.manifestDigest,
      expectedIdentityDigest: inspected.identityDigest, backup, receipt: join(f.directory, "native25-archive.jsonl"), writersStopped: true }))
      .toMatchObject({ status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false, phase: "migration-verified" });
    const copied = new DatabaseSync(backup, { readOnly: true }), afterDb = new DatabaseSync(f.file, { readOnly: true });
    let after;
    try {
      expect(snapshotPublicArchiveStorage(copied, f.identity, [pair[0]])).toEqual(before);
      after = snapshotPublicArchiveStorage(afterDb, f.identity, [pair[1]]);
      for (const [table, original] of Object.entries(before.tables)) expect(after.tables[table]).toEqual(original);
      for (const table of NATIVE_USER_DOMAIN_TABLES) expect(after.tables[table]).toEqual(before.tables[table]);
      for (const table of ["a2a_failed_original_fulfillments", "a2a_fulfillment_completions"])
        expect(after.tables[table]).toEqual(before.tables[table]);
      assertStorageIdentity(afterDb, f.identity); assertStorageFences(afterDb, f.identity);
      expect(afterDb.prepare("SELECT count(*) AS n FROM public_reference_articles").get()!.n).toBe(3);
    } finally { copied.close(); afterDb.close(); }
    expect(migratePublicReferenceArchiveStorage(f.file, f.identity, () => {})).toMatchObject({ status: "already-current" });
    const repeated = new DatabaseSync(f.file, { readOnly: true });
    try { expect(snapshotPublicArchiveStorage(repeated, f.identity, [pair[1]])).toEqual(after); }
    finally { repeated.close(); }
  });

  it.each([
    ["missing immutable native trigger", "DROP TRIGGER pending_job_owners_no_update", "source profile differs"],
    ["modified count-equivalent25 schema", "ALTER TABLE private_profiles ADD COLUMN unexpected TEXT", "source profile differs"],
    ["unknown future domain", "CREATE TABLE unexpected_native_family(id TEXT PRIMARY KEY)", "unsupported_table"],
  ])("refuses native archive activation with %s", (_name, sql, error) => {
    const f = fixture(true, false, true), changed = new DatabaseSync(f.file);
    let before;
    try { changed.exec(sql); before = sqliteApplicationSchemaProfile(changed, new Set()); } finally { changed.close(); }
    expect(() => migratePublicReferenceArchiveStorage(f.file, f.identity, () => {})).toThrow(error);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      expect(sqliteApplicationSchemaProfile(db, new Set())).toBe(before);
      expect(hasPublicReferenceArchive(db)).toBe(false); assertStorageIdentity(db, f.identity);
      if (error === "unsupported_table") expect(() => assertStorageFences(db, f.identity)).toThrow(error);
      else assertStorageFences(db, f.identity);
    }
    finally { db.close(); }
  });

  it("preserves streamed originals above 32 MiB without raising enrollment's encoded limit", () => {
    const f = fixture(), value = "x".repeat(1024 * 1024), pair = publicReferenceArchiveMigrationProfiles(true)[0]!;
    largeMetadata(f, value);
    const beforeDb = new DatabaseSync(f.file, { readOnly: true });
    let before;
    try { before = snapshotPublicArchiveStorage(beforeDb, f.identity, [pair[0]]); }
    finally { beforeDb.close(); }
    expect(33 * Buffer.byteLength(value)).toBeGreaterThan(STORAGE_SNAPSHOT_LIMITS.encodedBytes);
    expect(33 * Buffer.byteLength(value)).toBeLessThan(MIGRATION_FRAMED_BYTE_LIMIT);
    expect(migratePublicReferenceArchiveStorage(f.file, f.identity, () => {}))
      .toMatchObject({ status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    const afterDb = new DatabaseSync(f.file, { readOnly: true });
    try {
      const after = snapshotPublicArchiveStorage(afterDb, f.identity, [pair[1]]);
      for (const [table, original] of Object.entries(before.tables)) expect(after.tables[table]).toEqual(original);
    } finally { afterDb.close(); }
    const enrollment = new DatabaseSync(":memory:");
    try {
      enrollment.exec("CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT)");
      const insert = enrollment.prepare("INSERT INTO sync_state VALUES (?,?)");
      for (let index = 0; index < 33; index++) insert.run(String(index), value);
      expect(STORAGE_SNAPSHOT_LIMITS.encodedBytes).toBe(32 * 1024 * 1024);
      expect(() => scanFullStorageSnapshot(enrollment)).toThrow("encoded_byte_limit");
    } finally { enrollment.close(); }
  });

  it("refuses framed expansion above 64 MiB even when file, raw bytes and fields fit", () => {
    const f = fixture(), value = new Uint8Array(1024 * 1024);
    largeMetadata(f, value);
    expect(value.length).toBeLessThan(STORAGE_SNAPSHOT_LIMITS.fieldBytes);
    expect(33 * value.length).toBeLessThan(STORAGE_SNAPSHOT_LIMITS.totalBytes);
    // Typed blob encoding doubles payload bytes; framing crosses 64 MiB in a <64 MiB file.
    expect(33 * value.length * 2).toBeGreaterThan(MIGRATION_FRAMED_BYTE_LIMIT);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      expect(() => snapshotPublicArchiveStorage(db, f.identity, [publicReferenceArchiveMigrationProfiles(true)[0]![0]]))
        .toThrow("Public archive migration framed byte limit");
      assertStorageIdentity(db, f.identity); assertStorageFences(db, f.identity);
      expect(hasPublicReferenceArchive(db)).toBe(false);
    } finally { db.close(); }
  });

  it("adds archive under the original identity/fences while retaining every old row exactly", () => {
    const f = fixture(), pair = publicReferenceArchiveMigrationProfiles(true)[0]!;
    expect(profile(f.file, f.identity)).toBe(pair[0]);
    let admission = 0;
    const receipt = migratePublicReferenceArchiveStorage(f.file, f.identity, db => {
      expect(hasPublicReferenceArchive(db)).toBe(false); admission++;
    });
    expect(receipt).toMatchObject({ status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    expect(admission).toBe(1); expect(profile(f.file, f.identity)).toBe(pair[1]);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      assertStorageIdentity(db, f.identity); assertStorageFences(db, f.identity);
      expect(db.prepare("SELECT count(*) AS n FROM public_reference_articles").get()!.n).toBe(3);
      expect(JSON.parse(String(db.prepare("SELECT snapshot FROM public_references").get()!.snapshot))).toEqual(reference);
      expect(db.prepare("SELECT amount_usdc,settled,settlement_status FROM payment_events").get())
        .toMatchObject({ amount_usdc: 0.001, settled: 0, settlement_status: "pending" });
      const beforeRepeat = snapshotPublicArchiveStorage(db, f.identity, [pair[1]]);
      db.close();
      expect(migratePublicReferenceArchiveStorage(f.file, f.identity, () => {})).toMatchObject({ status: "already-current" });
      const afterRepeat = new DatabaseSync(f.file, { readOnly: true });
      try { expect(snapshotPublicArchiveStorage(afterRepeat, f.identity, [pair[1]])).toEqual(beforeRepeat); }
      finally { afterRepeat.close(); }
    } finally { try { db.close(); } catch { /* Already closed for exclusive repeat. */ } }
  });

  it.each([false, true])("rolls back all archive DDL and inserted prefixes for forged legacy items (native=%s)", nativeUserDomains => {
    const f = fixture(true, true, nativeUserDomains), before = profile(f.file, f.identity);
    expect(() => migratePublicReferenceArchiveStorage(f.file, f.identity, () => {})).toThrow("identity differs");
    expect(profile(f.file, f.identity)).toBe(before);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try { expect(hasPublicReferenceArchive(db)).toBe(false); assertStorageIdentity(db, f.identity); assertStorageFences(db, f.identity); }
    finally { db.close(); }
  });

  it("rejects absent backup admission, wrong identity, modified schema and callback source mutation", () => {
    const f = fixture(false), before = profile(f.file, f.identity);
    expect(() => migratePublicReferenceArchiveStorage(f.file, f.identity, undefined as never)).toThrow("backup admission");
    expect(() => migratePublicReferenceArchiveStorage(f.file, { ...f.identity, storageId: "00000000-0000-4000-8000-000000000001" }, () => {})).toThrow("identity_mismatch");
    expect(() => migratePublicReferenceArchiveStorage(f.file, f.identity, () => { throw new Error("Unverified backup"); })).toThrow("Unverified backup");
    expect(() => migratePublicReferenceArchiveStorage(f.file, f.identity, db => {
      registerStorageCapability(db, f.identity, () => true);
      db.prepare("UPDATE sync_state SET value='Changed historical row' WHERE key='retained-original'").run();
    })).toThrow("admission changed");
    expect(profile(f.file, f.identity)).toBe(before);
    const db = new DatabaseSync(f.file);
    try {
      expect(db.prepare("SELECT value FROM sync_state").get()!.value).toBe("Unchanged historical metadata");
      db.exec("CREATE INDEX unexpected_public_index ON public_references(active)");
    } finally { db.close(); }
    expect(() => migratePublicReferenceArchiveStorage(f.file, f.identity, () => {})).toThrow("source profile differs");
  });

  it("prepares and verifies a no-replace flushed backup and durable manifest-bound receipt", async () => {
    const f = fixture(), inspected = inspectPublicArchiveStorage(f.manifest);
    const backup = join(f.directory, "retained-original.sqlite"), receipt = join(f.directory, "migration.jsonl");
    const result = await migratePublicArchiveStorage({ manifest: f.manifest, expectedManifestDigest: inspected.manifestDigest,
      expectedIdentityDigest: inspected.identityDigest, backup, receipt, writersStopped: true });
    expect(result).toMatchObject({ status: "migrated", phase: "migration-verified", originalRowsPreserved: true, signingResumeAuthorized: false });
    const records = readFileSync(receipt, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(records.map(record => record.phase)).toEqual(["backup-verified", "migration-verified"]);
    expect(profile(backup, f.identity)).toBe(publicReferenceArchiveMigrationProfiles(true)[0]![0]);
    const backupDigest = createHash("sha256").update(readFileSync(backup)).digest("hex");
    await expect(migratePublicArchiveStorage({ manifest: f.manifest, expectedManifestDigest: inspected.manifestDigest,
      expectedIdentityDigest: storageIdentityDigest(f.identity), backup, receipt, writersStopped: true })).rejects.toThrow();
    expect(createHash("sha256").update(readFileSync(backup)).digest("hex")).toBe(backupDigest);
  });

  it("refuses mutation without stopped writers or exact manifest/identity evidence", async () => {
    const f = fixture(), inspected = inspectPublicArchiveStorage(f.manifest), before = profile(f.file, f.identity);
    const base = { manifest: f.manifest, expectedManifestDigest: inspected.manifestDigest, expectedIdentityDigest: inspected.identityDigest,
      backup: join(f.directory, "backup.sqlite"), receipt: join(f.directory, "receipt.jsonl"), writersStopped: true };
    await expect(migratePublicArchiveStorage({ ...base, writersStopped: false })).rejects.toThrow("refused");
    await expect(migratePublicArchiveStorage({ ...base, expectedManifestDigest: "a".repeat(64) })).rejects.toThrow("refused");
    await expect(migratePublicArchiveStorage({ ...base, expectedIdentityDigest: "b".repeat(64) })).rejects.toThrow("refused");
    await expect(runPublicArchiveStorageCli(["migrate", "--manifest", f.manifest])).rejects.toThrow("refused");
    expect(profile(f.file, f.identity)).toBe(before);
  });
});
