/** Explicit synthetic local records only: no funding, signature, network or vendor settlement. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { syntheticA2aOriginal } from "./a2a-original-fixture";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { createEnrolledSqliteDeliverableAcceptance, createSqliteDeliverableAcceptance } from "./deliverable-acceptance-sqlite";
import { originalBinding } from "../deliverable-acceptance/original";
import type { AcceptanceInput } from "../deliverable-acceptance/contracts";
import { canonicalJson } from "../canonical-json";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";
import { createEnrolledSqlitePersonalHistory } from "./personal-history-sqlite";

const synthetic = syntheticA2aOriginal(1, ARC_MAINNET_PROFILE);
const { order, binding } = synthetic;
const session = "aa".repeat(32), key = "synthetic-native-acceptance-key";
const authority = { kind: "session" as const, id: session };
let folder: string, complete: string, absent: string, identity: StorageIdentity, input: AcceptanceInput, index = 0;
const opened: Array<{ close(): void }> = [];

function originalRows(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return JSON.stringify(["a2a_orders", "payment_events", "research_purchase_authorizations"]
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())); }
  finally { db.close(); }
}
function entries(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Number(db.prepare("SELECT count(*) AS n FROM deliverable_acceptance_entries").get()?.n); }
  finally { db.close(); }
}
function edit(file: string, fn: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(file);
  // Explicit synthetic setup actor. This raw handle never qualifies as a native port.
  try { registerStorageCapability(db, identity, () => true); fn(db); } finally { db.close(); }
}
function native(bundle = true, readOnly = false, runtimeGuard?: () => void) {
  const file = join(folder, `case-${++index}.sqlite`); copyFileSync(bundle ? complete : absent, file);
  const connection = openVerifiedSqliteStorage(file, identity, { readOnly, runtimeGuard,
    applicationProfiles: supportedSqliteApplicationProfiles(true) });
  opened.push(connection);
  const port = createEnrolledSqliteDeliverableAcceptance(connection.db);
  return { file, connection, port };
}
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "keryx-synthetic-native-acceptance-"));
  complete = join(folder, "complete.sqlite"); absent = join(folder, "absent.sqlite");
  identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  for (const [file, bundle] of [[complete, true], [absent, false]] as const) {
    const db = new DatabaseSync(file);
    try {
      db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db);
      if (bundle) {
        installNativeUserDomainSchema(db);
        const response = JSON.stringify({ status: "completed", queryId: order.id,
          answer: "Explicit synthetic delivered answer", researchPackage: order.researchPackage });
        db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,
          amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,package_data,status,transaction_id,
          request_data,response_data,execution_journal_version,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.id, order.id, order.authorizationId, order.requestHash,
            order.payer, order.payee, order.amountUsdc, order.creatorBudgetUsdc, order.serviceFeeUsdc,
            order.researchMode, JSON.stringify(order.researchPackage), "completed", order.transaction,
            JSON.stringify(order.request), response, 1, order.createdAt, order.updatedAt);
        db.prepare(`INSERT INTO payment_events(id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,
          network,tx_hash,settled,settlement_status,authorization_id,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`inbound_${order.id}`, order.id, "inbound", "a2a", "Synthetic only",
            order.payer, order.payee, order.amountUsdc, binding.network, order.transaction, 1, "settled",
            order.authorizationId, order.createdAt);
        const now = Date.now();
        db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
          .run(session, order.payer, now - 1000, now + 600000);
        db.prepare("INSERT INTO api_keys(id,prefix,key_hash,wallet,created_at,scopes) VALUES(?,?,?,?,?,?)")
          .run(key, "synthetic-native-only", "synthetic-no-secret", order.payer, order.createdAt, "deliverable:write");
        const row = db.prepare("SELECT * FROM a2a_orders WHERE id=?").get(order.id)!;
        const seed = db.prepare("SELECT id FROM deliverable_acceptance_store WHERE singleton=1").get()!;
        const bound = originalBinding(String(seed.id), JSON.stringify({ order: row, deliveryText: response,
          settled: true, network: binding.network }), order.payer, binding.network, order.id);
        input = { originalFingerprint: bound.originalFingerprint, deliveredDigest: bound.deliveredDigest,
          expectedRevision: 0, idempotencyKey: "synthetic-native-request-0001", choice: "accept", reason: "", publishState: false };
      }
      insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
    } finally { db.close(); }
  }
});
afterEach(() => { for (const connection of opened.splice(0)) connection.close(); vi.unstubAllEnvs(); });
afterAll(() => { if (folder) rmSync(folder, { recursive: true, force: true }); });

it("rejects raw authority and extra arguments; the ordinary constructor still rejects enrollment", () => {
  const f = native(), raw = new DatabaseSync(f.file); opened.push(raw);
  expect(() => createEnrolledSqliteDeliverableAcceptance(raw)).toThrow();
  expect(() => Reflect.apply(createEnrolledSqliteDeliverableAcceptance, undefined, [f.connection.db, true])).toThrow();
  expect(() => createSqliteDeliverableAcceptance(f.connection.db)).toThrow();
  expect(entries(f.file)).toBe(0);
});
it("a supported original schema leaves the missing native port unavailable without DDL", () => {
  const f = native(false); expect(f.port).toBeUndefined();
  const raw = new DatabaseSync(f.file, { readOnly: true });
  try { expect(raw.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'deliverable_acceptance_%'").all()).toEqual([]); }
  finally { raw.close(); }
});
it("native user policy rejects raw or original-only stores and extra arguments", () => {
  const f = native(false), raw = new DatabaseSync(":memory:"); opened.push(raw);
  Object.assign(raw, { nativeUserDomainProfile: "invented", foreignKeys: true, busyTimeout: 5000 });
  expect(() => assertVerifiedSqliteNativeUserDomainPolicy(raw)).toThrow();
  expect(() => assertVerifiedSqliteNativeUserDomainPolicy(f.connection.db)).toThrow();
  expect(() => Reflect.apply(assertVerifiedSqliteNativeUserDomainPolicy, undefined, [f.connection.db, true])).toThrow();
});
it("complete native user policy is zero SQL, readonly-compatible and closed-aware", () => {
  let guards = 0; const f = native(true, true, () => { guards++; }), before = guards;
  for (let i = 0; i < 3; i++) expect(() => assertVerifiedSqliteNativeUserDomainPolicy(f.connection.db)).not.toThrow();
  expect(guards).toBe(before); f.connection.close();
  expect(() => assertVerifiedSqliteNativeUserDomainPolicy(f.connection.db)).toThrow();
});
it("reads genuine native retained delivery with no inferred remedy or public consent", async () => {
  const f = native(), before = originalRows(f.file);
  expect(Object.isFrozen(f.port)).toBe(true);
  const result = await f.port!.read(order.payer, binding.network, order.id);
  expect(result).toMatchObject({ state: "no_response", revision: 0, paidMicros: "30000", publishState: false,
    terms: { remedy: "none", responseWindow: null, silence: "no_response" }, refundExecution: "withheld", revisionExecution: "withheld" });
  expect(originalRows(f.file)).toBe(before); expect(entries(f.file)).toBe(0);
});
it.each(["accept", "revise", "reject"] as const)("appends native %s only to its private journal", async choice => {
  const f = native(), before = originalRows(f.file);
  const result = await f.port!.submit(order.payer, binding.network, order.id,
    { ...input, choice, reason: "Private synthetic reason" }, authority);
  expect(result).toMatchObject({ revision: 1, state: choice === "accept" ? "accepted" : choice === "revise" ? "revision_requested" : "rejected",
    reason: "Private synthetic reason", publishState: false, refundExecution: "withheld", revisionExecution: "withheld" });
  expect((await f.port!.publicState(binding.network, order.id)).state).toBe("not_shared");
  expect(entries(f.file)).toBe(1); expect(originalRows(f.file)).toBe(before);
});
it("a duplicate request returns the same revision without appending or changing financial originals", async () => {
  const f = native(), before = originalRows(f.file);
  await f.port!.submit(order.payer, binding.network, order.id, input, authority);
  expect((await f.port!.submit(order.payer, binding.network, order.id, input, authority)).revision).toBe(1);
  expect(entries(f.file)).toBe(1); expect(originalRows(f.file)).toBe(before);
});
it("explicit publication exposes only choice/time and counts no customer traction", async () => {
  const f = native(); const saved = await f.port!.submit(order.payer, binding.network, order.id,
    { ...input, reason: "Keep this private", publishState: true }, { kind: "api-key", id: key });
  expect(await f.port!.publicState(binding.network, order.id)).toEqual({ format: "keryx-public-deliverable-state-v1",
    state: "accepted", submittedAt: saved.submittedAt });
  expect(await f.port!.metrics(binding.network)).toMatchObject({ accepted: 1, outsideCustomers: null,
    acceptanceRate: null, classification: "unmeasured" });
});
it.each(["session", "key-scope", "key-revoked", "cross-wallet"] as const)("rechecks %s authority before a native append", async mode => {
  const f = native(), before = originalRows(f.file);
  edit(f.file, db => {
    if (mode === "session") db.prepare("DELETE FROM web_sessions WHERE hash=?").run(session);
    else if (mode === "key-scope") db.prepare("UPDATE api_keys SET scopes='deliverable:read' WHERE id=?").run(key);
    else if (mode === "key-revoked") db.prepare("UPDATE api_keys SET revoked_at=? WHERE id=?").run(order.createdAt, key);
    else db.prepare("UPDATE web_sessions SET wallet=? WHERE hash=?").run(`0x${"33".repeat(20)}`, session);
  });
  await expect(f.port!.submit(order.payer, binding.network, order.id, input,
    mode.startsWith("key") ? { kind: "api-key", id: key } : authority)).rejects.toThrow("acceptance_unauthenticated");
  expect(entries(f.file)).toBe(0); expect(originalRows(f.file)).toBe(before);
});
it.each(["missing-settlement", "changed-delivery", "other-owner", "other-network"] as const)("refuses %s without financial mutation", async mode => {
  const f = native();
  if (mode === "missing-settlement") edit(f.file, db => db.prepare("UPDATE payment_events SET settled=0,settlement_status='pending'").run());
  if (mode === "changed-delivery") edit(f.file, db => db.prepare("UPDATE a2a_orders SET response_data=? WHERE id=?")
    .run(JSON.stringify({ status: "completed", queryId: order.id, answer: "Changed synthetic delivery" }), order.id));
  const before = originalRows(f.file);
  await expect(f.port!.submit(mode === "other-owner" ? `0x${"33".repeat(20)}` : order.payer,
    mode === "other-network" ? "eip155:5042002" : binding.network, order.id, input, authority)).rejects.toThrow();
  expect(entries(f.file)).toBe(0); expect(originalRows(f.file)).toBe(before);
});
it("a readonly write refusal preserves the native reader and its originals", async () => {
  const f = native(true, true), before = originalRows(f.file);
  await expect(f.port!.submit(order.payer, binding.network, order.id, input, authority)).rejects.toThrow("acceptance_unavailable");
  expect((await f.port!.read(order.payer, binding.network, order.id)).state).toBe("no_response");
  expect(entries(f.file)).toBe(0); expect(originalRows(f.file)).toBe(before);
});
it("real BEGIN contention refuses the write but preserves this port and an unrelated native reader", async () => {
  const f = native(), before = originalRows(f.file), blocker = new DatabaseSync(f.file); opened.push(blocker);
  blocker.exec("BEGIN IMMEDIATE");
  await expect(f.port!.submit(order.payer, binding.network, order.id, input, authority)).rejects.toThrow("acceptance_unavailable");
  blocker.exec("ROLLBACK");
  expect((await f.port!.read(order.payer, binding.network, order.id)).state).toBe("no_response");
  expect(f.connection.db.prepare("SELECT count(*) AS n FROM api_keys").get()?.n).toBe(1);
  expect(() => assertVerifiedSqliteConnection(f.connection.db)).not.toThrow();
  expect(entries(f.file)).toBe(0); expect(originalRows(f.file)).toBe(before);
});
it("an internal SQL guard failure permanently retires the borrowed port after the guard is restored", async () => {
  let calls = 0, failAt = Infinity; const f = native(true, false, () => { if (++calls === failAt) throw new Error("Synthetic manifest guard failure"); });
  const before = originalRows(f.file); failAt = calls + 3;
  await expect(f.port!.publicState(binding.network, order.id)).rejects.toThrow("acceptance_unavailable");
  failAt = Infinity;
  await expect(f.port!.read(order.payer, binding.network, order.id)).rejects.toThrow("acceptance_unavailable");
  expect(() => assertVerifiedSqliteConnection(f.connection.db)).toThrow();
  expect(entries(f.file)).toBe(0); expect(originalRows(f.file)).toBe(before);
});
it("real EXCLUSIVE read contention preserves the native port and unrelated reader after the lock is released", async () => {
  const f = native(), before = originalRows(f.file), blocker = new DatabaseSync(f.file); opened.push(blocker);
  blocker.exec("BEGIN EXCLUSIVE");
  await expect(f.port!.read(order.payer, binding.network, order.id)).rejects.toThrow("acceptance_unavailable");
  blocker.exec("ROLLBACK");
  expect((await f.port!.read(order.payer, binding.network, order.id)).state).toBe("no_response");
  expect(f.connection.db.prepare("SELECT count(*) AS n FROM api_keys").get()?.n).toBe(1);
  expect(entries(f.file)).toBe(0); expect(originalRows(f.file)).toBe(before);
});
it("the native personal-history reader also survives real EXCLUSIVE read contention", async () => {
  const f = native(), history = createEnrolledSqlitePersonalHistory(f.connection.db), before = originalRows(f.file);
  const blocker = new DatabaseSync(f.file); opened.push(blocker); blocker.exec("BEGIN EXCLUSIVE");
  await expect(history.list(order.payer, { filters: {}, take: 1 })).rejects.toThrow("history_unavailable");
  blocker.exec("ROLLBACK");
  expect(await history.list(order.payer, { filters: {}, take: 1 })).toEqual([]);
  expect(originalRows(f.file)).toBe(before);
});
it("schema drift permanently retires the old port even after the exact schema is restored", async () => {
  const f = native(), raw = new DatabaseSync(f.file); opened.push(raw);
  raw.exec("CREATE TABLE synthetic_unknown_namespace(id TEXT)");
  await expect(f.port!.read(order.payer, binding.network, order.id)).rejects.toThrow("acceptance_unavailable");
  raw.exec("DROP TABLE synthetic_unknown_namespace");
  await expect(f.port!.read(order.payer, binding.network, order.id)).rejects.toThrow("acceptance_unavailable");
  expect(entries(f.file)).toBe(0);
});
// One immutable selected deployment tuple per module; each case opens fresh genuine facades.
let facadeFixture: Readonly<{ file: string; manifest: string }> | undefined;
function selectedFacadeFixture() {
  if (!facadeFixture) {
    const file = join(folder, "facade.sqlite"), manifest = join(folder, "deployment.json"); copyFileSync(complete, file);
    writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
      backend: { kind: "sqlite", databasePath: file } }));
    facadeFixture = Object.freeze({ file, manifest });
  }
  vi.stubEnv("KERYX_STORAGE_MANIFEST", facadeFixture.manifest); vi.stubEnv("KERYX_SQLITE_PATH", facadeFixture.file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  return facadeFixture;
}
it("the actual frozen native application facade composes the port on writable and readonly stores without DDL", async () => {
  const { file } = selectedFacadeFixture();
  const before = originalRows(file), writer = await createEnrolledSqliteAdapter(); opened.push(writer);
  const reader = await createReadonlyEnrolledSqliteAdapter(); opened.push(reader);
  for (const adapter of [writer, reader]) {
    expect(Object.isFrozen(adapter)).toBe(true); expect(Object.isFrozen(adapter.deliverableAcceptance)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(adapter, "deliverableAcceptance")?.enumerable).toBe(false);
  }
  await expect(reader.deliverableAcceptance!.submit(order.payer, binding.network, order.id, input, authority)).rejects.toThrow("acceptance_unavailable");
  expect((await writer.deliverableAcceptance!.read(order.payer, binding.network, order.id)).state).toBe("no_response");
  expect(originalRows(file)).toBe(before); expect(entries(file)).toBe(0);
});
it("the actual native application facade survives EXCLUSIVE contention on the same writer without changing originals", async () => {
  const { file } = selectedFacadeFixture();
  const before = originalRows(file), writer = await createEnrolledSqliteAdapter(); opened.push(writer);
  const blocker = new DatabaseSync(file); opened.push(blocker); blocker.exec("BEGIN EXCLUSIVE");
  expect(() => writer.getSyncState("synthetic-missing")).toThrow(); blocker.exec("ROLLBACK");
  expect(await writer.getSyncState("synthetic-missing")).toBeNull();
  expect((await writer.deliverableAcceptance!.read(order.payer, binding.network, order.id)).state).toBe("no_response");
  expect(originalRows(file)).toBe(before); expect(entries(file)).toBe(0);
});
