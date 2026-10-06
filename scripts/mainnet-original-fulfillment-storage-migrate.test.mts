import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../lib/canonical-json";
import { installMainnetApplicationSchema } from "../lib/db/mainnet-application-schema";
import { insertStorageIdentity, installStorageFences, readStorageIdentity } from "../lib/db/storage-identity-sqlite";
import { STORAGE_MAINNET_PROFILE_DIGEST, validateStorageIdentity, type StorageIdentity } from "../lib/db/storage-identity";
import { openVerifiedSqliteStorage } from "../lib/db/storage-identity-connection";
import { originalFulfillmentSchemaProfiles } from "../lib/db/a2a-fulfillment-migration";
import * as migrationModule from "../lib/db/a2a-fulfillment-migration";
import { inspectOriginalFulfillmentStorage, migrateOriginalFulfillmentStorage } from "./mainnet-economic-storage-migrate.mjs";
import { runOriginalFulfillmentStorageCli } from "./mainnet-original-fulfillment-storage-migrate.mjs";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { syntheticFailedOriginal } from "../lib/db/a2a-fulfillment-fixture";
import { seedSyntheticA2aOriginal } from "../lib/db/a2a-original-fixture";
import { ARC_MAINNET_PROFILE } from "../lib/arc-network-profile";

const cleanup: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) close(); });
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "keryx-fulfillment-migration-")), file = join(folder, "original.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042",
    profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
  const native = new DatabaseSync(file);
  installMainnetApplicationSchema(native, { originalFulfillment: false }); insertStorageIdentity(native, validateStorageIdentity(identity));
  installStorageFences(native, identity); native.close();
  const connection = openVerifiedSqliteStorage(file, identity, { applicationProfiles: [originalFulfillmentSchemaProfiles()[0]] });
  const core = SqliteAdapter.assembleConnectionCore(connection.db, identity, () => {});
  const original = await seedSyntheticA2aOriginal(core, syntheticFailedOriginal(1, ARC_MAINNET_PROFILE));
  connection.close();
  const manifestFile = join(folder, "manifest.json"), manifest = canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } });
  writeFileSync(manifestFile, manifest + "\n");
  const inspection = inspectOriginalFulfillmentStorage(manifestFile);
  const options = { manifest: manifestFile, expectedManifestDigest: inspection.manifestDigest, expectedIdentityDigest: inspection.identityDigest,
    backup: join(folder, "before.sqlite"), receipt: join(folder, "migration.jsonl"), writersStopped: true };
  return { folder, file, manifestFile, manifest, identity, original, inspection, options };
}

it("backs up and verifies the exact predecessor, retaining failed original, settlement, identity and authority", async () => {
  const f = await fixture();
  expect(() => openVerifiedSqliteStorage(f.file, f.identity, { applicationProfiles: [originalFulfillmentSchemaProfiles()[1]] })).toThrow();
  const result = await migrateOriginalFulfillmentStorage(f.options);
  expect(result).toMatchObject({ format: "keryx-original-fulfillment-storage-migration-v1", status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
  expect(JSON.stringify(result)).not.toContain(f.file);
  expect(readFileSync(f.manifestFile, "utf8")).toBe(f.manifest + "\n");
  const original = new DatabaseSync(f.file, { readOnly: true }), backup = new DatabaseSync(f.options.backup, { readOnly: true });
  try {
    expect(readStorageIdentity(original)).toEqual(readStorageIdentity(backup));
    for (const table of ["a2a_orders", "research_purchase_authorizations", "payment_events"])
      expect(original.prepare(`SELECT * FROM ${table}`).all()).toEqual(backup.prepare(`SELECT * FROM ${table}`).all());
    for (const table of ["a2a_failed_original_fulfillments", "a2a_fulfillment_completions"]) {
      expect(backup.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").get(table)).toBeUndefined();
      expect(original.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
  } finally { original.close(); backup.close(); }
  const verified = openVerifiedSqliteStorage(f.file, f.identity, { applicationProfiles: [originalFulfillmentSchemaProfiles()[1]] }); verified.close();
  expect(() => openVerifiedSqliteStorage(f.file, f.identity, { applicationProfiles: [originalFulfillmentSchemaProfiles()[0]] })).toThrow();
  const untrusted = new DatabaseSync(f.file);
  try { expect(() => untrusted.exec("INSERT INTO a2a_failed_original_fulfillments VALUES('foreign','claim','{}','{}','now')")).toThrow(); }
  finally { untrusted.close(); }
  expect(readFileSync(f.options.receipt, "utf8").trim().split("\n").map(line => JSON.parse(line).phase))
    .toEqual(["backup-verified", "migration-verified"]);
});

it("refuses absent drain, wrong binding, unknown schema and backup reuse before DDL", async () => {
  const f = await fixture();
  await expect(migrateOriginalFulfillmentStorage({ ...f.options, writersStopped: false })).rejects.toThrow();
  await expect(migrateOriginalFulfillmentStorage({ ...f.options, expectedIdentityDigest: "aa".repeat(32) })).rejects.toThrow();
  expect(existsSync(f.options.backup)).toBe(false);
  writeFileSync(f.options.backup, "retained backup");
  await expect(migrateOriginalFulfillmentStorage(f.options)).rejects.toThrow();
  expect(readFileSync(f.options.backup, "utf8")).toBe("retained backup");
  const native = new DatabaseSync(f.file); native.exec("CREATE TABLE unexpected(value TEXT)"); native.close();
  await expect(migrateOriginalFulfillmentStorage({ ...f.options, backup: join(f.folder, "new.sqlite"), receipt: join(f.folder, "new.jsonl") })).rejects.toThrow();
  expect(existsSync(join(f.folder, "new.sqlite"))).toBe(false);
});

it("refuses an exact source race at backup admission and preserves the incomplete receipt", async () => {
  const f = await fixture(), migrate = migrationModule.migrateFailedOriginalFulfillmentStorage;
  vi.spyOn(migrationModule, "migrateFailedOriginalFulfillmentStorage").mockImplementation((file, identity, guard) => {
    const changed = openVerifiedSqliteStorage(file, identity, { applicationProfiles: [originalFulfillmentSchemaProfiles()[0]] });
    changed.db.exec("UPDATE a2a_orders SET updated_at='2026-10-06T03:24:04.000Z'"); changed.close();
    return migrate(file, identity, guard);
  });
  await expect(migrateOriginalFulfillmentStorage(f.options)).rejects.toThrow();
  const native = new DatabaseSync(f.file, { readOnly: true });
  try { expect(native.prepare("SELECT 1 FROM sqlite_schema WHERE name='a2a_failed_original_fulfillments'").get()).toBeUndefined(); }
  finally { native.close(); }
  expect(readFileSync(f.options.receipt, "utf8").trim().split("\n").map(line => JSON.parse(line).phase)).toEqual(["backup-verified"]);
});

it("CLI inspection is readonly, complete mutation args are explicit, and a fresh current backup is idempotent", async () => {
  const f = await fixture();
  expect(await runOriginalFulfillmentStorageCli(["inspect", "--manifest", f.manifestFile])).toEqual(f.inspection);
  await expect(runOriginalFulfillmentStorageCli(["migrate", "--manifest", f.manifestFile])).rejects.toThrow();
  expect(existsSync(f.options.backup)).toBe(false);
  const result = await runOriginalFulfillmentStorageCli(["migrate", "--manifest", f.manifestFile, "--expected-manifest", f.inspection.manifestDigest,
    "--expected-identity", f.inspection.identityDigest, "--backup", f.options.backup, "--receipt", f.options.receipt, "--writers-stopped"]);
  expect(result).toMatchObject({ status: "migrated" });
  expect((await migrateOriginalFulfillmentStorage({ ...f.options, backup: join(f.folder, "second.sqlite"), receipt: join(f.folder, "second.jsonl") })).status).toBe("already-current");
});
