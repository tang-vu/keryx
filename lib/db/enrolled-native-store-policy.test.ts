/** Genuine isolated SQLite only; no provider, signing, spend or shared database. */
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteSelectedApplicationPolicy, isVerifiedSqliteConnection,
  openVerifiedSqliteStorage, readVerifiedSqliteAllocatedBytes } from "./storage-identity-connection";
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

it("reads allocated uncommitted pages through fixed metadata only and retains application PRAGMA denials", () => {
  let guards = 0;
  const f = fixture(true, true, { runtimeGuard: () => { guards++; }, applicationProfiles: supportedSqliteApplicationProfiles(true) });
  const db = f.connection.db, before = readVerifiedSqliteAllocatedBytes(db), priorGuards = guards;
  for (const sql of ["PRAGMA page_count", "PRAGMA page_size", "PRAGMA page_size=8192", "PRAGMA page_count=1"])
    expect(() => db.prepare(sql).get()).toThrow();
  db.exec("SAVEPOINT synthetic_allocation");
  db.prepare("INSERT INTO sync_state(key,value) VALUES('synthetic-allocation',zeroblob(?))").run(4 * 1024 * 1024);
  expect(readVerifiedSqliteAllocatedBytes(db)).toBeGreaterThan(before);
  expect(guards).toBeGreaterThan(priorGuards);
  db.exec("ROLLBACK TO synthetic_allocation; RELEASE synthetic_allocation");
  expect(readVerifiedSqliteAllocatedBytes(db)).toBe(before);
  for (const sql of ["PRAGMA page_count", "PRAGMA page_size", "PRAGMA page_size=8192"])
    expect(() => db.prepare(sql).get()).toThrow();
  expect(() => Reflect.get(db, "setAuthorizer")).toThrow("Unsupported");
});

it("allocation metadata rejects unverified, closed and revoked connections without ordinary fallback", () => {
  const raw = new DatabaseSync(":memory:"); opened.push(raw);
  expect(isVerifiedSqliteConnection(raw)).toBe(false);
  expect(() => readVerifiedSqliteAllocatedBytes(raw)).toThrow("storage_unavailable");
  let revoked = false;
  const f = fixture(true, true, { runtimeGuard: () => { if (revoked) throw new Error("Synthetic allocation revocation"); },
    applicationProfiles: supportedSqliteApplicationProfiles(true) });
  expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true);
  expect(() => Reflect.apply(readVerifiedSqliteAllocatedBytes, undefined, [f.connection.db, "PRAGMA page_count"])).toThrow("storage_unavailable");
  revoked = true; expect(() => readVerifiedSqliteAllocatedBytes(f.connection.db)).toThrow("Synthetic allocation revocation");
  expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true);
  f.connection.close(); expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true);
  expect(() => readVerifiedSqliteAllocatedBytes(f.connection.db)).toThrow("closed");
});

it.each(["profile", "fence"])("allocation metadata preserves the full %s drift refusal", kind => {
  const f = fixture(true, true, { runtimeGuard() {}, applicationProfiles: supportedSqliteApplicationProfiles(true) });
  expect(readVerifiedSqliteAllocatedBytes(f.connection.db)).toBeGreaterThan(0);
  const raw = new DatabaseSync(f.file);
  try {
    if (kind === "profile") raw.exec("CREATE INDEX synthetic_allocation_drift ON query_runs(created_at)");
    else {
      const name = String(raw.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name GLOB 'storage_fence_*' LIMIT 1").get()!.name);
      raw.exec(`DROP TRIGGER "${name}"`);
    }
  } finally { raw.close(); }
  expect(() => readVerifiedSqliteAllocatedBytes(f.connection.db)).toThrow(kind === "profile" ? "schema migration required" : "fence_missing_or_changed");
  expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true);
});

it.skipIf(process.platform === "win32")("allocation metadata refuses a replaced target inode", () => {
  const f = fixture(true, true, { runtimeGuard() {}, applicationProfiles: supportedSqliteApplicationProfiles(true) });
  renameSync(f.file, `${f.file}.retained`); copyFileSync(template(true, true), f.file);
  expect(() => readVerifiedSqliteAllocatedBytes(f.connection.db)).toThrow("target_replaced");
  expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true);
});

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

it("opens a fresh enrolled reader after a short native writer lock without changing the database", async () => {
  const f = fixture(false, true);
  const before = readFileSync(f.file), shared = new SharedArrayBuffer(8), state = new Int32Array(shared);
  const worker = new Worker(`
    const { workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const state = new Int32Array(workerData.shared), db = new DatabaseSync(workerData.file);
    try {
      db.exec('BEGIN EXCLUSIVE'); Atomics.store(state, 0, 1); Atomics.notify(state, 0);
      if (Atomics.wait(state, 1, 0, 5000) === 'timed-out') throw new Error('Reader did not start');
      Atomics.wait(state, 0, 1, 500);
      db.exec('ROLLBACK');
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  `, { eval: true, workerData: { file: f.file, shared } });
  const exited = new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", code => code === 0 ? resolve() : reject(new Error(`Native writer exited ${code}`)));
  });
  try {
    expect(Atomics.wait(state, 0, 0, 5000)).not.toBe("timed-out");
    expect(Atomics.load(state, 0)).toBe(1);
    const connection = openVerifiedSqliteStorage(f.file, identity, { readOnly: true,
      runtimeGuard() { if (Atomics.compareExchange(state, 1, 0, 1) === 0) Atomics.notify(state, 1); },
      applicationProfiles: supportedSqliteApplicationProfiles(true) });
    opened.push(connection);
    expect(connection.db.prepare("SELECT id FROM query_runs WHERE id=?").get("synthetic-owned")?.id).toBe("synthetic-owned");
    expect(() => assertVerifiedSqliteConnection(connection.db, "write")).toThrow("storage_unavailable");
  } finally { await exited; }
  expect(readFileSync(f.file)).toEqual(before);
});
