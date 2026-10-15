import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { PRIVATE_PROFILES_SQL } from "./private-profiles-sqlite";
import { migratePrivateProfilesStorage, privateProfilesMigrationProfiles, snapshotPrivateProfilesStorage } from "./private-profiles-storage-migration";
import { assertStorageFences, assertStorageIdentity, insertStorageIdentity, installStorageFences, registerStorageCapability,
  storageFenceStatements } from "./storage-identity-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema-data";
import { OWNER269_OCCUPANCY_PROPOSAL } from "../owner-run-assignments/occupancy-proposal";
import { inspectPrivateProfileStorage, migratePrivateProfileStorage, runPrivateProfileStorageCli } from "../../scripts/private-profile-storage-migrate.mjs";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(archive = false) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-profile-migration-")); directories.push(directory);
  const file = join(directory, "native.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db, { publicReferenceArchive: archive });
    // Synthetic originals cover real/integer/null/blob/invalid-UTF8 TEXT and
    // >JS-safe integer cells. None of these are real financial acceptance.
    db.exec("INSERT INTO sync_state(key,value,updated_at) VALUES('raw-text',CAST(X'fffe00c3' AS TEXT),NULL)");
    db.exec("INSERT INTO query_runs(id,question,budget,duration_ms,data) VALUES('original','Historical question',0.03125,9007199254740993,'{}')");
    db.prepare(`INSERT INTO payment_events(id,query_id,network,settled,settlement_status,amount_usdc,kind,rationale,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run("pending-original", "original", identity.network, 0, "pending", 0.001, "fetch", Buffer.from([0, 255, 128]), "2026-10-01T00:00:00.000Z");
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  return { directory, file, manifest, identity };
}
function snapshot(f: ReturnType<typeof fixture>, file = f.file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return snapshotPrivateProfilesStorage(db, f.identity, privateProfilesMigrationProfiles().flat()); }
  finally { db.close(); }
}
function schema(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all(); }
  finally { db.close(); }
}
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("explicit additive native user-domain storage migration", () => {
  it("the exact mainnet archive/profile cross-product remains four; legacy profiles are unchanged", () => {
    const pairs = privateProfilesMigrationProfiles(); expect(pairs).toHaveLength(2);
    expect(new Set(pairs.flat()).size).toBe(4);
    expect(new Set(supportedSqliteApplicationProfiles(true))).toEqual(new Set(pairs.flat()));
    expect(supportedSqliteApplicationProfiles(false)).toHaveLength(4);
    expect(supportedSqliteApplicationProfiles(false).some(profile => profile.includes('"tbl_name":"private_profiles"'))).toBe(false);
  });

  it.each([false, true])("installs the complete fixed bundle and preserves every old typed schema/row (archive=%s)", archive => {
    const f = fixture(archive), before = snapshot(f), oldSchema = schema(f.file), backup = join(f.directory, "backup.sqlite");
    copyFileSync(f.file, backup); const backupDigest = digest(backup);
    let admitted = 0;
    const result = migratePrivateProfilesStorage(f.file, f.identity, db => {
      expect(db.isTransaction).toBe(true); admitted++;
      expect(snapshotPrivateProfilesStorage(db, f.identity, privateProfilesMigrationProfiles().flat())).toEqual(snapshot(f, backup));
    });
    expect(admitted).toBe(1); expect(result).toMatchObject({ status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    const after = snapshot(f), retained = { ...after.tables };
    for (const table of NATIVE_USER_DOMAIN_TABLES) {
      expect(retained[table].rows).toBe(table === "deliverable_acceptance_store" ? 1 : 0);
      delete retained[table];
    }
    expect(retained).toEqual(before.tables); expect(digest(backup)).toBe(backupDigest);
    const newSchema = schema(f.file), oldNames = new Set(oldSchema.map(row => row.name));
    expect(newSchema.filter(row => oldNames.has(row.name))).toEqual(oldSchema);
    const added = newSchema.filter(row => !oldNames.has(row.name));
    expect(added.filter(row => row.type === "table").map(row => String(row.name)).sort()).toEqual([...NATIVE_USER_DOMAIN_TABLES].sort());
    expect(added.every(row => NATIVE_USER_DOMAIN_TABLES.includes(String(row.tbl_name) as typeof NATIVE_USER_DOMAIN_TABLES[number])
      || ["query_runs", "query_memories"].includes(String(row.tbl_name))
      || row.type === "trigger" && OWNER269_OCCUPANCY_PROPOSAL.some(guard => guard.name === row.name
        && guard.sql === row.sql && guard.sql.includes(` ON ${String(row.tbl_name)}\n`)))).toBe(true);
    for (const guard of OWNER269_OCCUPANCY_PROPOSAL)
      expect(added).toContainEqual({ type: "trigger", name: guard.name, tbl_name: guard.sql.match(/ ON ([a-z0-9_]+)\n/)![1], sql: guard.sql });
    const db = new DatabaseSync(f.file, { readOnly: true });
    try { assertStorageIdentity(db, f.identity); assertStorageFences(db, f.identity);
      expect(Object.entries(storageFenceStatements(db, f.identity)).filter(([, sql]) => sql.includes('ON "private_profiles"'))).toHaveLength(3);
      for (const table of NATIVE_USER_DOMAIN_TABLES) expect(Object.entries(storageFenceStatements(db, f.identity))
        .filter(([, sql]) => sql.includes(`ON "${table}"`))).toHaveLength(3);
      expect(db.prepare("SELECT singleton,id FROM deliverable_acceptance_store").all()).toEqual([
        { singleton: 1, id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) },
      ]);
      expect(db.prepare("SELECT settled,settlement_status,amount_usdc,hex(rationale) AS blob FROM payment_events").get())
        .toMatchObject({ settled: 0, settlement_status: "pending", amount_usdc: 0.001, blob: "00FF80" });
    } finally { db.close(); }
    expect(migratePrivateProfilesStorage(f.file, f.identity, () => {})).toMatchObject({ status: "already-current" });
    expect(snapshot(f)).toEqual(after);
  });

  it("already-current retains existing private rows instead of resetting the domain", () => {
    const f = fixture(); migratePrivateProfilesStorage(f.file, f.identity, () => {});
    const db = new DatabaseSync(f.file);
    try { registerStorageCapability(db, f.identity, () => true);
      db.prepare("INSERT INTO private_profiles VALUES(?,?,'Reader','','','[]',?,?)")
        .run(`0x${"a".repeat(40)}`, "retained", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    } finally { db.close(); }
    const before = snapshot(f);
    expect(migratePrivateProfilesStorage(f.file, f.identity, () => {})).toMatchObject({ status: "already-current" });
    expect(snapshot(f)).toEqual(before);
  });

  it("a middle-fence DDL failure rolls back the table, both autoindexes and any inserted fence prefix", () => {
    const f = fixture(), before = snapshot(f), oldSchema = schema(f.file);
    let fences = 0;
    const original = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql.startsWith("CREATE TRIGGER storage_fence_") && sql.includes('ON "private_profiles"') && ++fences === 2) throw new Error("Injected middle DDL refusal");
      return Reflect.apply(original, this, [sql]);
    });
    try { expect(() => migratePrivateProfilesStorage(f.file, f.identity, () => {})).toThrow("Injected middle DDL refusal"); }
    finally { spy.mockRestore(); }
    expect(fences).toBe(2); expect(schema(f.file)).toEqual(oldSchema); expect(snapshot(f)).toEqual(before);
  });

  it.each([
    "CREATE TABLE private_profiles(unknown TEXT)",
    PRIVATE_PROFILES_SQL,
    "CREATE INDEX unreviewed_original_index ON query_runs(asker)",
    "DROP TRIGGER storage_identity_no_update",
  ])("partial/unknown/changed source refuses without adoption: %s", sql => {
    const f = fixture(), db = new DatabaseSync(f.file); try { db.exec(sql); } finally { db.close(); }
    const before = digest(f.file);
    expect(() => migratePrivateProfilesStorage(f.file, f.identity, () => {})).toThrow(); expect(digest(f.file)).toBe(before);
  });

  it("missing backup admission, wrong identity or callback mutation cannot commit", () => {
    const f = fixture(), before = snapshot(f), oldSchema = schema(f.file);
    expect(() => migratePrivateProfilesStorage(f.file, f.identity, undefined as never)).toThrow("backup admission");
    expect(() => migratePrivateProfilesStorage(f.file, { ...f.identity, storageId: "00000000-0000-4000-8000-000000000001" }, () => {})).toThrow("identity_mismatch");
    expect(() => migratePrivateProfilesStorage(f.file, f.identity, () => { throw new Error("Unverified backup"); })).toThrow("Unverified backup");
    // The admission callback is trusted operator code, not an application port.
    // Even deliberate removal of its readonly authorizer cannot hide row changes.
    expect(() => migratePrivateProfilesStorage(f.file, f.identity, db => {
      db.setAuthorizer(null); registerStorageCapability(db, f.identity, () => true);
      db.exec("UPDATE sync_state SET value='rewritten' WHERE key='raw-text'");
    })).toThrow("admission changed");
    expect(snapshot(f)).toEqual(before); expect(schema(f.file)).toEqual(oldSchema);
  });

  it.each([
    "CREATE TABLE bypass(x)", "UPDATE sync_state SET value='rewrite'", "DELETE FROM query_runs",
    "ATTACH DATABASE ':memory:' AS bypass", "SELECT load_extension('bypass')", "COMMIT",
  ])("backup admission denies out-of-scope SQL: %s", sql => {
    const f = fixture(), before = snapshot(f), oldSchema = schema(f.file);
    expect(() => migratePrivateProfilesStorage(f.file, f.identity, db => { db.exec(sql); })).toThrow();
    expect(snapshot(f)).toEqual(before); expect(schema(f.file)).toEqual(oldSchema);
  });

  it("the operator source creates a verified no-replace backup and durable receipt preserving typed originals", async () => {
    const f = fixture(), inspected = inspectPrivateProfileStorage(f.manifest), before = snapshot(f);
    const backup = join(f.directory, "retained.sqlite"), receipt = join(f.directory, "receipt.jsonl");
    const options = { manifest: f.manifest, expectedManifestDigest: inspected.manifestDigest, expectedIdentityDigest: inspected.identityDigest,
      backup, receipt, writersStopped: true };
    const result = await migratePrivateProfileStorage(options);
    expect(result).toMatchObject({ phase: "migration-verified", status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    expect(snapshot(f, backup)).toEqual(before); const backupDigest = digest(backup);
    const records = readFileSync(receipt, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(records.map(row => row.phase)).toEqual(["backup-verified", "migration-verified"]);
    expect(records[0].manifestDigest).toBe(inspected.manifestDigest); expect(records[0].identityDigest).toBe(inspected.identityDigest);
    await expect(migratePrivateProfileStorage(options)).rejects.toThrow(); expect(digest(backup)).toBe(backupDigest);
    await expect(migratePrivateProfileStorage({ ...options, receipt: join(f.directory, "second-receipt.jsonl") })).rejects.toThrow();
    expect(digest(backup)).toBe(backupDigest);
  });

  it("stopped-writer assertion and exact manifest/identity are required before backup or target mutation", async () => {
    const f = fixture(), inspected = inspectPrivateProfileStorage(f.manifest), before = digest(f.file);
    const options = { manifest: f.manifest, expectedManifestDigest: inspected.manifestDigest, expectedIdentityDigest: inspected.identityDigest,
      backup: join(f.directory, "backup.sqlite"), receipt: join(f.directory, "receipt.jsonl"), writersStopped: true };
    await expect(migratePrivateProfileStorage({ ...options, writersStopped: false })).rejects.toThrow("refused");
    await expect(migratePrivateProfileStorage({ ...options, expectedManifestDigest: "a".repeat(64) })).rejects.toThrow("refused");
    await expect(migratePrivateProfileStorage({ ...options, expectedIdentityDigest: "b".repeat(64) })).rejects.toThrow("refused");
    await expect(runPrivateProfileStorageCli(["migrate", "--manifest", f.manifest])).rejects.toThrow("refused");
    expect(digest(f.file)).toBe(before);
    const wrong = { ...f.identity, ...syntheticStorageIdentity("testnet-real") };
    expect(() => migratePrivateProfilesStorage(f.file, wrong, () => {})).toThrow("mainnet source required");
  });

  it("manifest change during native backup preserves backup/receipt evidence and refuses DDL", async () => {
    const f = fixture(), inspected = inspectPrivateProfileStorage(f.manifest), before = snapshot(f);
    const backup = join(f.directory, "backup.sqlite"), receipt = join(f.directory, "receipt.jsonl");
    const original = DatabaseSync.prototype.prepare;
    let inspectedBackup = false;
    const active = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
      // Readonly backup readback follows backup creation and precedes the
      // mandatory manifest recheck. Change only the synthetic manifest there.
      if (!inspectedBackup && existsSync(backup) && sql === "PRAGMA integrity_check(1)") {
        inspectedBackup = true; writeFileSync(f.manifest, "{}");
      }
      return Reflect.apply(original, this, [sql]);
    });
    try { await expect(migratePrivateProfileStorage({ manifest: f.manifest, expectedManifestDigest: inspected.manifestDigest,
      expectedIdentityDigest: inspected.identityDigest, backup, receipt, writersStopped: true })).rejects.toThrow(); }
    finally { active.mockRestore(); }
    expect(inspectedBackup).toBe(true); expect(snapshot(f)).toEqual(before); expect(snapshot(f, backup)).toEqual(before);
  });

  it("post-commit acknowledgement failure retains the migrated store; it does not restore or delete originals", () => {
    const f = fixture(), before = snapshot(f);
    const original = DatabaseSync.prototype.exec; let committed = false, sourceTransaction = false;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      // Reference installers finish before the EXCLUSIVE source transaction.
      if (sql.includes("BEGIN EXCLUSIVE")) { sourceTransaction = true; committed = false; }
      if (sql === "BEGIN" && committed) throw new Error("Injected postcommit acknowledgement failure");
      const result = Reflect.apply(original, this, [sql]);
      if (sql === "COMMIT" && sourceTransaction) committed = true;
      return result;
    });
    try { expect(() => migratePrivateProfilesStorage(f.file, f.identity, () => {})).toThrow("Injected postcommit acknowledgement failure"); }
    finally { spy.mockRestore(); }
    const after = snapshot(f), retained = { ...after.tables };
    for (const table of NATIVE_USER_DOMAIN_TABLES) delete retained[table];
    expect(retained).toEqual(before.tables); expect(after.tables.private_profiles.rows).toBe(0);
    expect(migratePrivateProfilesStorage(f.file, f.identity, () => {})).toMatchObject({ status: "already-current" });
  });
});
