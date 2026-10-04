import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability, readStorageIdentity } from "./storage-identity-sqlite";
import { STORAGE_MAINNET_PROFILE_DIGEST, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { migrateSessionWithdrawalAbortStorage } from "./session-withdrawal-abort-migration";
import { sessionWithdrawalFixture } from "../gateway/session-withdrawal-test-fixture";
import { canonicalJson } from "../canonical-json";
import { sqliteJournalTransaction } from "./sqlite-browser-journal";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";

it("migrates only the exact sealed predecessor, retains exposed originals and refuses old readers", async () => {
  const folder = mkdtempSync(join(tmpdir(), "keryx-abort-migration-")), file = join(folder, "store.sqlite");
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042",
    profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
  let db = new DatabaseSync(file);
  try {
    const p = await sessionWithdrawalFixture(), c = p.authorization.consent;
    installMainnetApplicationSchema(db, { publicationAbort: false });
    const oldProfile = sqliteApplicationSchemaProfile(db, new Set());
    insertStorageIdentity(db, validateStorageIdentity(identity)); installStorageFences(db, identity); registerStorageCapability(db, identity, () => true);
    sqliteJournalTransaction(db, () => {
      db.prepare("INSERT INTO session_grant_consents VALUES(?,?,?,?,?,?,?,?,?)").run(c.grantEpoch, c.ownerAddr, c.sessAddr,
        canonicalJson(c), 1, 2, 2, p.authorization.ownerSignature, p.authorization.sessionSignature);
      db.prepare("INSERT INTO session_withdrawal_preparations(request_id,recovery_owner,signer,grant_epoch,data) VALUES(?,?,?,?,?)")
        .run(p.requestId, p.ownerAddr, p.sessAddr, p.grantEpoch, canonicalJson(p));
      db.prepare("INSERT INTO session_withdrawal_exposures VALUES(?)").run(p.requestId);
    });
    const oldRows = db.prepare("SELECT * FROM session_withdrawal_preparations").all();
    const oldIdentity = readStorageIdentity(db);
    db.close();
    expect(() => migrateSessionWithdrawalAbortStorage(file, { ...identity, storageId: randomUUID() })).toThrow();
    let guarded = false;
    expect(() => migrateSessionWithdrawalAbortStorage(file, identity, opened => {
      expect(opened.isTransaction).toBe(true);
      expect(opened.prepare("SELECT data FROM session_withdrawal_preparations").get()?.data).toBe(canonicalJson(p));
      guarded = true; throw new Error("Synthetic changed backup admission");
    })).toThrow("Synthetic changed backup admission");
    expect(guarded).toBe(true);
    db = new DatabaseSync(file);
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='session_withdrawal_publication_aborts'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM session_withdrawal_preparations").all()).toEqual(oldRows);
    db.close();
    const migrated = migrateSessionWithdrawalAbortStorage(file, identity);
    expect(migrated.status).toBe("migrated"); expect(migrated.beforeSchemaDigest).not.toBe(migrated.afterSchemaDigest);
    expect(migrateSessionWithdrawalAbortStorage(file, identity).status).toBe("already-current");
    expect(() => openVerifiedSqliteStorage(file, identity, { applicationProfiles: [oldProfile] })).toThrow();
    const admitted = openVerifiedSqliteStorage(file, identity, { applicationProfiles: supportedSqliteApplicationProfiles(true) });
    expect(admitted.db.prepare("SELECT count(*) AS n FROM session_withdrawal_exposures").get()?.n).toBe(1);
    admitted.close();
    db = new DatabaseSync(file);
    expect(readStorageIdentity(db)).toEqual(oldIdentity);
    expect(db.prepare("SELECT * FROM session_withdrawal_preparations").all()).toEqual(oldRows);
    expect(db.prepare("SELECT request_id FROM session_withdrawal_exposures").get()?.request_id).toBe(p.requestId);
    expect(db.prepare("SELECT count(*) AS n FROM session_withdrawal_publication_aborts").get()?.n).toBe(0);
    expect(() => db.prepare("INSERT INTO session_withdrawal_publication_aborts VALUES(?,?)").run(p.requestId, "{}")).toThrow();
    db.exec("CREATE TABLE unexpected(value TEXT)"); db.close();
    expect(() => migrateSessionWithdrawalAbortStorage(file, identity)).toThrow();
    db = new DatabaseSync(file);
    expect(db.prepare("SELECT * FROM session_withdrawal_preparations").all()).toEqual(oldRows);
  } finally { try { db.close(); } catch { /* A refused migration retained its own connection. */ } rmSync(folder, { recursive: true, force: true }); }
});
