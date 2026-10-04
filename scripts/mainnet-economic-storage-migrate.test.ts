import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson } from "../lib/canonical-json";
import { installMainnetApplicationSchema } from "../lib/db/mainnet-application-schema";
import { insertStorageIdentity, installStorageFences, readStorageIdentity, registerStorageCapability } from "../lib/db/storage-identity-sqlite";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, validateStorageIdentity, type StorageIdentity } from "../lib/db/storage-identity";
import { hostedTreasuryPolicyDigest, validateHostedTreasuryPolicy, type HostedTreasuryPolicy } from "../lib/payments/hosted-treasury-policy";
import { sqliteJournalTransaction } from "../lib/db/sqlite-browser-journal";
import { openVerifiedSqliteStorage } from "../lib/db/storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "../lib/db/enrolled-sqlite-schema-profile";
import * as migrationModule from "../lib/db/session-withdrawal-abort-migration";
import { inspectEconomicStorage, migrateEconomicStorage, runEconomicStorageCli } from "./mainnet-economic-storage-migrate.mjs";

const folders: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) {
  if (!resolve(folder).startsWith(join(tmpdir(), "keryx-economic-migration-"))) throw new Error("Unexpected cleanup target");
  rmSync(folder, { recursive: true, force: true });
} });
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "keryx-economic-migration-")); folders.push(folder);
  const file = join(folder, "original.sqlite"), manifestFile = join(folder, "manifest.json");
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042",
    profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
  const policy: HostedTreasuryPolicy = { format: "keryx-hosted-treasury-policy-v1", network: "eip155:5042",
    storageIdentityDigest: storageIdentityDigest(identity), origin: "https://example.com", signer: `0x${"22".repeat(20)}`,
    lifetimeCapMicroUsdc: "3000000", queryCapMicroUsdc: "50000", expiresAtSeconds: 2000000000 };
  const db = new DatabaseSync(file);
  installMainnetApplicationSchema(db, { publicationAbort: false });
  insertStorageIdentity(db, validateStorageIdentity(identity)); installStorageFences(db, identity); registerStorageCapability(db, identity, () => true);
  sqliteJournalTransaction(db, () => {
    db.prepare("INSERT INTO hosted_treasury_policies VALUES(?,?,?,?)").run(hostedTreasuryPolicyDigest(policy), policy.signer, "public", canonicalJson(policy));
    db.prepare("INSERT INTO payment_events(id,network,settlement_status,settled,amount_usdc,authorization_id,payer,payee) VALUES(?,?,?,?,?,?,?,?)")
      .run("x402:retained-mainnet-nonce", "eip155:5042", "settled", 1, 0.0157, "retained-mainnet-nonce", policy.signer, `0x${"33".repeat(20)}`);
    db.exec("UPDATE payment_events SET rationale=CAST(X'80FF' AS TEXT)");
    db.prepare("INSERT INTO browser_signer_capacity VALUES(?,?)").run(`0x${"44".repeat(20)}`, 15700);
  });
  db.close();
  const manifest = canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } });
  writeFileSync(manifestFile, manifest + "\n");
  const inspection = inspectEconomicStorage(manifestFile);
  return { folder, file, identity, policy, manifestFile, manifest, inspection,
    options: { manifest: manifestFile, expectedManifestDigest: inspection.manifestDigest, expectedIdentityDigest: inspection.identityDigest,
      backup: join(folder, "before.sqlite"), receipt: join(folder, "migration.jsonl"), writersStopped: true } };
}

it("backs up real mainnet evidence and preserves exact enrolled identity, policies, caps and payment rows", async () => {
  const f = fixture();
  const result = await migrateEconomicStorage(f.options);
  expect(result).toMatchObject({ status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
  const stages = readFileSync(f.options.receipt, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(stages.map(row => row.phase)).toEqual(["backup-verified", "migration-verified"]);
  expect(stages[0].beforeSnapshotDigest).toBe(f.inspection.snapshotDigest);
  expect(stages[1].identityDigest).toBe(f.inspection.identityDigest);
  expect(readFileSync(f.manifestFile, "utf8")).toBe(f.manifest + "\n");
  expect(JSON.stringify(result)).not.toContain(f.file);
  const original = new DatabaseSync(f.file, { readOnly: true }), saved = new DatabaseSync(f.options.backup, { readOnly: true });
  try {
    for (const table of ["keryx_storage_identity", "hosted_treasury_policies", "browser_signer_capacity", "payment_events"]) {
      expect(original.prepare(`SELECT * FROM ${table}`).all()).toEqual(saved.prepare(`SELECT * FROM ${table}`).all());
    }
    expect(readStorageIdentity(original)).toEqual(readStorageIdentity(saved));
    expect(original.prepare("SELECT hex(CAST(rationale AS BLOB)) AS raw FROM payment_events").get()?.raw).toBe("80FF");
    const retainedPolicy = JSON.parse(original.prepare("SELECT data FROM hosted_treasury_policies").get()!.data as string);
    expect(validateHostedTreasuryPolicy(retainedPolicy, readStorageIdentity(original)!)).toEqual(f.policy);
    expect(saved.prepare("SELECT 1 FROM sqlite_schema WHERE name='session_withdrawal_publication_aborts'").get()).toBeUndefined();
    expect(original.prepare("SELECT count(*) AS n FROM session_withdrawal_publication_aborts").get()?.n).toBe(0);
  } finally { original.close(); saved.close(); }
  const current = openVerifiedSqliteStorage(f.file, f.identity, { applicationProfiles: supportedSqliteApplicationProfiles(true) }); current.close();
  expect(() => openVerifiedSqliteStorage(f.options.backup, f.identity, { applicationProfiles: supportedSqliteApplicationProfiles(true) })).toThrow();
  const repeated = await migrateEconomicStorage({ ...f.options, backup: join(f.folder, "second.sqlite"), receipt: join(f.folder, "second.jsonl") });
  expect(repeated.status).toBe("already-current");
});

it("refuses absent drain assertion, wrong binding, changed manifest, unknown schema and existing backup without mutating original", async () => {
  const f = fixture();
  await expect(migrateEconomicStorage({ ...f.options, writersStopped: false })).rejects.toThrow();
  await expect(migrateEconomicStorage({ ...f.options, expectedIdentityDigest: "aa".repeat(32) })).rejects.toThrow();
  await expect(migrateEconomicStorage({ ...f.options, expectedManifestDigest: "aa".repeat(32) })).rejects.toThrow();
  expect(existsSync(f.options.backup)).toBe(false);
  writeFileSync(f.options.backup, "retained evidence");
  await expect(migrateEconomicStorage(f.options)).rejects.toThrow();
  expect(readFileSync(f.options.backup, "utf8")).toBe("retained evidence");
  expect(inspectEconomicStorage(f.manifestFile)).toEqual(f.inspection);
  const db = new DatabaseSync(f.file); db.exec("CREATE TABLE unexpected(value TEXT)"); db.close();
  await expect(migrateEconomicStorage({ ...f.options, backup: join(f.folder, "new.sqlite"), receipt: join(f.folder, "new.jsonl") })).rejects.toThrow();
  expect(existsSync(join(f.folder, "new.sqlite"))).toBe(false);
  const original = new DatabaseSync(f.file, { readOnly: true });
  expect(original.prepare("SELECT 1 FROM sqlite_schema WHERE name='session_withdrawal_publication_aborts'").get()).toBeUndefined(); original.close();
});

it("CLI inspect is read-only and mutation requires every explicit argument", async () => {
  const f = fixture();
  expect(await runEconomicStorageCli(["inspect", "--manifest", f.manifestFile])).toEqual(f.inspection);
  await expect(runEconomicStorageCli(["migrate", "--manifest", f.manifestFile])).rejects.toThrow();
  expect(existsSync(f.options.backup)).toBe(false);
  const result = await runEconomicStorageCli(["migrate", "--manifest", f.manifestFile,
    "--expected-manifest", f.inspection.manifestDigest, "--expected-identity", f.inspection.identityDigest,
    "--backup", f.options.backup, "--receipt", f.options.receipt, "--writers-stopped"]);
  expect(result).toMatchObject({ phase: "migration-verified" });
});

it.each(["source", "backup"])("refuses a same-inode %s change before DDL under the exclusive migration lock", async target => {
  const f = fixture(), migrate = migrationModule.migrateSessionWithdrawalAbortStorage;
  vi.spyOn(migrationModule, "migrateSessionWithdrawalAbortStorage").mockImplementation((file, identity, guard) => {
    const changed = new DatabaseSync(target === "source" ? file : f.options.backup);
    registerStorageCapability(changed, identity, () => true);
    // Both byte strings decode to replacement characters; byte verification must
    // distinguish them, and compare the original again after acquiring the lock.
    sqliteJournalTransaction(changed, () => changed.exec("UPDATE payment_events SET rationale=CAST(X'81FF' AS TEXT)"));
    changed.close();
    return migrate(file, identity, guard);
  });
  await expect(migrateEconomicStorage(f.options)).rejects.toThrow();
  const original = new DatabaseSync(f.file, { readOnly: true });
  try {
    expect(original.prepare("SELECT 1 FROM sqlite_schema WHERE name='session_withdrawal_publication_aborts'").get()).toBeUndefined();
    expect(original.prepare("SELECT count(*) AS n FROM payment_events").get()?.n).toBe(1);
  } finally { original.close(); }
  const stages = readFileSync(f.options.receipt, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(stages.map(row => row.phase)).toEqual(["backup-verified"]);
  expect(existsSync(f.options.backup)).toBe(true);
});
