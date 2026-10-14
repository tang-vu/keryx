/** Genuine isolated SQLite only; no provider, signing, spend or shared database. */
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteSelectedApplicationPolicy, openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { createEnrolledSqliteRunPrivacy, isEnrolledSqlitePrivacyContention } from "./run-privacy-sqlite";
import { PrivacyError } from "../run-privacy/contracts";
import { writeSqliteQueryRun } from "./query-run-record";

let directory: string, identity: StorageIdentity, index = 0;
const opened: Array<{ close(): void }> = [];
const template = (archive: boolean, bundle: boolean) => join(directory, `${archive}-${bundle}.sqlite`);
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "keryx-native-selected-policy-"));
  identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  for (const archive of [false, true]) for (const bundle of [false, true]) {
    const raw = new DatabaseSync(template(archive, bundle));
    try {
      raw.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(raw, { publicReferenceArchive: archive });
      if (bundle) installNativeUserDomainSchema(raw);
      writeSqliteQueryRun(raw, { id: "synthetic-owned", createdAt: new Date().toISOString(),
        question: "Synthetic question", answer: "Synthetic answer", budget: 0, engine: "heuristic",
        totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [], paymentMode: "offline" }, false);
      insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT");
    } finally { raw.close(); }
  }
});
afterEach(() => { for (const connection of opened.splice(0)) connection.close(); });
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
function fixture(archive = false, bundle = true, options: Parameters<typeof openVerifiedSqliteStorage>[2] = {}) {
  const file = join(directory, `case-${++index}.sqlite`); copyFileSync(template(archive, bundle), file);
  const connection = openVerifiedSqliteStorage(file, identity, options); opened.push(connection);
  return { file, connection };
}

it.each([[false, false], [false, true], [true, false], [true, true]])(
  "selected policy accepts exact mainnet archive=%s bundle=%s without another SQL guard", (archive, bundle) => {
    let calls = 0;
    const f = fixture(archive, bundle, { readOnly: true, runtimeGuard: () => { calls++; },
      applicationProfiles: supportedSqliteApplicationProfiles(true) });
    const before = calls;
    expect(() => assertVerifiedSqliteSelectedApplicationPolicy(f.connection.db)).not.toThrow();
    expect(() => assertVerifiedSqliteSelectedApplicationPolicy(f.connection.db)).not.toThrow();
    expect(calls).toBe(before);
    expect(() => assertVerifiedSqliteConnection(f.connection.db)).not.toThrow();
    expect(calls).toBeGreaterThan(before);
    f.connection.close(); expect(() => assertVerifiedSqliteSelectedApplicationPolicy(f.connection.db)).toThrow();
  });
it("a verified identity alone cannot supply the selected runtime/schema policy", () => {
  const noProfiles = fixture(false, false, { runtimeGuard: () => {} });
  const noRuntime = fixture(false, true, { applicationProfiles: supportedSqliteApplicationProfiles(true) });
  expect(() => assertVerifiedSqliteConnection(noProfiles.connection.db)).not.toThrow();
  expect(() => assertVerifiedSqliteConnection(noRuntime.connection.db)).not.toThrow();
  for (const f of [noProfiles, noRuntime]) expect(() => assertVerifiedSqliteSelectedApplicationPolicy(f.connection.db)).toThrow();
});
it("caller properties, extra arguments and later options mutation cannot create authority", () => {
  const raw = new DatabaseSync(":memory:"); opened.push(raw);
  Object.assign(raw, { selectedApplicationProfile: "invented", foreignKeys: true, busyTimeout: 5000 });
  expect(() => assertVerifiedSqliteSelectedApplicationPolicy(raw)).toThrow();
  const options: Parameters<typeof openVerifiedSqliteStorage>[2] = { applicationProfiles: supportedSqliteApplicationProfiles(true) };
  const f = fixture(false, true, options); options.runtimeGuard = () => {};
  expect(() => assertVerifiedSqliteSelectedApplicationPolicy(f.connection.db)).toThrow();
  expect(() => Reflect.apply(assertVerifiedSqliteSelectedApplicationPolicy, undefined, [f.connection.db, true])).toThrow();
});
it("fabricated privacy errors and SQL-looking causes never qualify as native contention", () => {
  const fake = Object.assign(new PrivacyError("privacy_unavailable"), {
    errcode: 5, cause: Object.assign(new Error("Caller supplied"), { code: "ERR_SQLITE_ERROR", errcode: 5 }) });
  expect(isEnrolledSqlitePrivacyContention(fake)).toBe(false);
  expect(isEnrolledSqlitePrivacyContention(fake.cause)).toBe(false);
  expect(isEnrolledSqlitePrivacyContention(new PrivacyError("not_found"))).toBe(false);
});
it("selected BEFORE proof cannot follow a caller-approved unknown profile after drift", () => {
  const indexSql = "CREATE INDEX selected_policy_drift ON query_runs(created_at)";
  const reference = new DatabaseSync(":memory:"); let unknownProfile: string;
  try {
    installMainnetApplicationSchema(reference); reference.exec(indexSql);
    unknownProfile = sqliteApplicationSchemaProfile(reference, new Set());
  } finally { reference.close(); }
  const f = fixture(false, false, { runtimeGuard: () => {},
    applicationProfiles: [supportedSqliteApplicationProfiles(true)[0], unknownProfile] });
  expect(() => assertVerifiedSqliteSelectedApplicationPolicy(f.connection.db)).not.toThrow();
  expect(() => assertVerifiedSqliteConnection(f.connection.db)).not.toThrow();
  const raw = new DatabaseSync(f.file);
  try { raw.exec(indexSql); } finally { raw.close(); }
  // Metadata is a prerequisite only; every operation still needs this full guard.
  expect(() => assertVerifiedSqliteConnection(f.connection.db)).toThrow("SQLite application schema migration required");
});
it("an actual EXCLUSIVE lock returns a branded fixed refusal and preserves the shared connection", async () => {
  const f = fixture(false, true, { runtimeGuard: () => {}, applicationProfiles: supportedSqliteApplicationProfiles(true) });
  const privacy = createEnrolledSqliteRunPrivacy(f.connection.db), blocker = new DatabaseSync(f.file); opened.push(blocker);
  blocker.exec("BEGIN EXCLUSIVE");
  let refusal: unknown;
  try { await privacy.read("synthetic-owned"); } catch (error) { refusal = error; }
  expect(refusal).toBeInstanceOf(PrivacyError); expect((refusal as Error).message).toBe("privacy_unavailable");
  expect(isEnrolledSqlitePrivacyContention(refusal)).toBe(true);
  expect(Reflect.apply(isEnrolledSqlitePrivacyContention, undefined, [refusal, true])).toBe(false);
  expect(refusal).not.toHaveProperty("cause"); expect(refusal).not.toHaveProperty("errcode");
  blocker.exec("ROLLBACK");
  expect(() => assertVerifiedSqliteConnection(f.connection.db)).not.toThrow();
  expect((await privacy.read("synthetic-owned")).exists).toBe(true);
});
it("non-contention runtime revocation remains permanently refused", async () => {
  let failed = false;
  const f = fixture(false, true, { runtimeGuard: () => { if (failed) throw new Error("Synthetic revoked guard"); },
    applicationProfiles: supportedSqliteApplicationProfiles(true) });
  const privacy = createEnrolledSqliteRunPrivacy(f.connection.db); failed = true;
  let refusal: unknown;
  try { await privacy.read("synthetic-owned"); } catch (error) { refusal = error; }
  expect(isEnrolledSqlitePrivacyContention(refusal)).toBe(false); failed = false;
  await expect(privacy.read("synthetic-owned")).rejects.toThrow("privacy_unavailable");
  expect(() => assertVerifiedSqliteSelectedApplicationPolicy(f.connection.db)).toThrow();
});
