import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEnrolledSqlitePendingJobOwners } from "./pending-job-owners-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { migratePendingJobOwnersStorage, pendingJobOwnersMigrationProfiles, snapshotPendingJobOwnersStorage } from "./pending-job-owners-storage-migration";

// Authored fixture only: the source worker does not execute this setup. Parent
// controls run it in a temporary store, with no real account or payment input.
function withNative(readOnly: boolean, present: boolean, action: (db: DatabaseSync, guardCalls: () => number) => void) {
  const folder = mkdtempSync(join(tmpdir(), "keryx-pending-owner-refusal-"));
  const file = join(folder, "synthetic.sqlite");
  const identity = { ...syntheticStorageIdentity("mainnet-real"),
    format: "keryx-mainnet-storage-identity-v1" as const,
    network: "eip155:5042" as const, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  let connection: ReturnType<typeof openVerifiedSqliteStorage> | undefined;
  let guardCalls = 0;
  try {
    const setup = new DatabaseSync(file);
    try {
      setup.exec("BEGIN IMMEDIATE");
      installMainnetApplicationSchema(setup);
      if (present) installNativeUserDomainSchema(setup);
      insertStorageIdentity(setup, identity); installStorageFences(setup, identity);
      setup.exec("COMMIT");
    } finally { setup.close(); }
    connection = openVerifiedSqliteStorage(file, identity, { readOnly,
      applicationProfiles: supportedSqliteApplicationProfiles(true), runtimeGuard() { guardCalls++; } });
    action(connection.db, () => guardCalls);
  } finally {
    connection?.close();
    rmSync(folder, { recursive: true, force: true });
  }
}

// No provenance/module mock: fake and real foreign native connections cannot
// acquire the private factory's trusted WeakMap provenance.
describe("pending owner admission factory rejection", () => {
  it("refuses caller objects before calling SQL, guards or close methods", () => {
    const fake = { prepare: vi.fn(), exec: vi.fn(), close: vi.fn(), guard: vi.fn() };
    expect(() => createEnrolledSqlitePendingJobOwners(fake as unknown as DatabaseSync)).toThrow("owner_association_unavailable");
    for (const method of Object.values(fake)) expect(method).not.toHaveBeenCalled();
  });
  it("refuses a real foreign native connection without changing it", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE sentinel(id INTEGER PRIMARY KEY); INSERT INTO sentinel VALUES(1)");
      expect(() => createEnrolledSqlitePendingJobOwners(db)).toThrow("owner_association_unavailable");
      expect(db.prepare("SELECT id FROM sentinel").get()?.id).toBe(1);
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'pending_job_%'").all()).toEqual([]);
      expect(db.isTransaction).toBe(false);
    } finally { db.close(); }
  });
  it("refuses a missing connection and extra caller-supplied capabilities", () => {
    expect(() => Reflect.apply(createEnrolledSqlitePendingJobOwners, undefined, [])).toThrow("owner_association_unavailable");
    expect(() => Reflect.apply(createEnrolledSqlitePendingJobOwners, undefined, [null])).toThrow("owner_association_unavailable");
    const guard = vi.fn();
    expect(() => Reflect.apply(createEnrolledSqlitePendingJobOwners, undefined, [{}, guard])).toThrow("owner_association_unavailable");
    expect(guard).not.toHaveBeenCalled();
  });
  it("exposes only a reader on genuine writable native provenance and never mints from a candidate", () => {
    withNative(false, true, db => {
      const before = db.prepare("SELECT count(*) AS n FROM a2a_orders").get()?.n;
      const port = createEnrolledSqlitePendingJobOwners(db)!;
      expect(Object.keys(port).sort()).toEqual(["assertAdmission", "list"]);
      expect(() => port.assertAdmission({} as never)).toThrow("session_unavailable");
      expect(db.prepare("SELECT count(*) AS n FROM a2a_orders").get()?.n).toBe(before);
      expect(db.isTransaction).toBe(false);
    });
  });
  it("refuses actual readonly native admission before SQL and leaves its reader usable", () => {
    withNative(true, true, (db, guardCalls) => {
      // Every SQL operation on this genuine proxy invokes runtimeGuard. Do not
      // replace its methods or inject a mock provenance/guard into the factory.
      const port = createEnrolledSqlitePendingJobOwners(db)!;
      const before = guardCalls();
      expect(() => port.assertAdmission({} as never)).toThrow("session_unavailable");
      expect(guardCalls()).toBe(before);
      expect(db.prepare("SELECT count(*) AS n FROM a2a_orders").get()?.n).toBe(0);
    });
  });
  it("refuses missing native user schema without inventing a port or installing tables", () => {
    withNative(false, false, db => {
      expect(createEnrolledSqlitePendingJobOwners(db)).toBeUndefined();
      expect(db.prepare("SELECT 1 AS n").get()?.n).toBe(1);
    });
  });
});

it.each([false, true])("explicit stopped-writer migration preserves typed originals and creates no owner (archive=%s)", archive => {
  const folder = mkdtempSync(join(tmpdir(), "keryx-pending-owner-migration-")), file = join(folder, "synthetic.sqlite");
  const identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1" as const,
    network: "eip155:5042" as const, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  let original: ReturnType<typeof snapshotPendingJobOwnersStorage> | undefined;
  try {
    const setup = new DatabaseSync(file);
    try {
      setup.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(setup, { publicReferenceArchive: archive });
      installNativeUserDomainSchema(setup); setup.exec("DROP TABLE pending_job_owners");
      setup.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
        .run("a".repeat(64), `0x${"b".repeat(40)}`, 1000, 2000);
      insertStorageIdentity(setup, identity); installStorageFences(setup, identity); setup.exec("COMMIT");
    } finally { setup.close(); }
    const pair = pendingJobOwnersMigrationProfiles()[archive ? 1 : 0];
    const receipt = migratePendingJobOwnersStorage(file, identity, db => {
      original = snapshotPendingJobOwnersStorage(db, identity, pair);
      expect(() => db.exec("DELETE FROM web_sessions")).toThrow();
    });
    expect(receipt.originalRowsPreserved).toBe(true); expect(receipt.signingResumeAuthorized).toBe(false);
    const inspect = new DatabaseSync(file, { readOnly: true });
    try {
      const after = snapshotPendingJobOwnersStorage(inspect, identity, [pair[1]]);
      const { pending_job_owners, ...retained } = after.tables;
      expect(pending_job_owners.rows).toBe(0); expect(retained).toEqual(original!.tables);
    } finally { inspect.close(); }
    expect(supportedSqliteApplicationProfiles(true)).toHaveLength(4);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
