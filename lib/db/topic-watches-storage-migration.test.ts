import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { migrateTopicWatchesStorage, snapshotTopicWatchesStorage, topicWatchesMigrationProfiles, ownerRunAssignmentsMigrationProfiles } from "./topic-watches-storage-migration";
import { OWNER269_OCCUPANCY_PROPOSAL } from "../owner-run-assignments/occupancy-proposal";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(archive = false, oldFamily: 19 | 20 = 19) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-watch-migration-")); directories.push(directory);
  const file = join(directory, "full19.sqlite"), backup = join(directory, "backup.sqlite");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN"); installMainnetApplicationSchema(db, { publicReferenceArchive: archive }); installNativeUserDomainSchema(db);
    // Disposable source-built old families, distinct from current full22.
    for (const guard of OWNER269_OCCUPANCY_PROPOSAL) db.exec(`DROP TRIGGER "${guard.name}"`);
    db.exec("DROP TABLE owner269_associations; DROP TABLE owner269_operations");
    if (oldFamily === 19) db.exec("DROP TABLE topic_watches");
    db.exec("INSERT INTO sync_state(key,value,updated_at) VALUES('raw-text',CAST(X'fffe00' AS TEXT),NULL)");
    db.exec("INSERT INTO query_runs(id,question,budget,duration_ms,data,created_at) VALUES('retained','Original',0.03125,9007199254740993,'{}','2026-10-15T00:00:00.000Z')");
    db.exec("INSERT INTO payment_events(id,query_id,network,amount_usdc,kind,rationale) VALUES('original','retained','eip155:5042',0.007,'fetch',X'00ff80')");
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
  const snapshot = (target = file) => {
    const connection = new DatabaseSync(target, { readOnly: true });
    try { return snapshotTopicWatchesStorage(connection, identity, [...topicWatchesMigrationProfiles(), ...ownerRunAssignmentsMigrationProfiles()].flat()); }
    finally { connection.close(); }
  };
  return { file, backup, identity, snapshot };
}
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
describe("explicit stopped-writer full19 watch migration (authored, UNRUN)", () => {
  it("keeps runtime profile family exact four; historical full19 is migration-only", () => {
    const runtime = supportedSqliteApplicationProfiles(true), pairs = [...topicWatchesMigrationProfiles(), ...ownerRunAssignmentsMigrationProfiles()];
    expect(runtime).toHaveLength(4); expect(new Set(runtime).size).toBe(4); expect(pairs).toHaveLength(4);
    for (const [before, after] of pairs) { expect(runtime).not.toContain(before); expect(runtime).toContain(after); }
  });
  it.each([[false, 19], [true, 19], [false, 20], [true, 20]] as const)("preserves every historical typed original and backup (archive=%s, oldFamily=%s)", (archive, oldFamily) => {
    const f = fixture(archive, oldFamily), before = f.snapshot(); copyFileSync(f.file, f.backup); const backupHash = hash(f.backup);
    let admissions = 0;
    const result = migrateTopicWatchesStorage(f.file, f.identity, connection => {
      admissions++; expect(connection.isTransaction).toBe(true);
      expect(snapshotTopicWatchesStorage(connection, f.identity, [...topicWatchesMigrationProfiles(), ...ownerRunAssignmentsMigrationProfiles()].flat())).toEqual(f.snapshot(f.backup));
    });
    expect(admissions).toBe(1); expect(result).toMatchObject({ status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    const after = f.snapshot(), retained = { ...after.tables };
    for (const table of ["topic_watches", "owner269_operations", "owner269_associations"]) if (!(table in before.tables)) {
      expect(retained[table].rows).toBe(0); delete retained[table];
    }
    expect(retained).toEqual(before.tables); expect(hash(f.backup)).toBe(backupHash);
    expect(migrateTopicWatchesStorage(f.file, f.identity, () => {})).toMatchObject({ status: "already-current" });
    expect(f.snapshot()).toEqual(after);
  });
  it("refuses absent/rejected backup admission with no source change", () => {
    const f = fixture(), before = f.snapshot();
    expect(() => migrateTopicWatchesStorage(f.file, f.identity, undefined as never)).toThrow("admission required");
    expect(() => migrateTopicWatchesStorage(f.file, f.identity, () => { throw new Error("Backup not admitted"); })).toThrow("Backup not admitted");
    expect(f.snapshot()).toEqual(before);
  });
  it("denies mutation in backup admission and leaves the old source intact", () => {
    const f = fixture(), before = f.snapshot();
    expect(() => migrateTopicWatchesStorage(f.file, f.identity, db => db.exec("DELETE FROM sync_state"))).toThrow();
    expect(f.snapshot()).toEqual(before);
  });
});
