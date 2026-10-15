// UNRUN source fixtures. Actual JWT crypto, native SQLite, manifest and facade;
// only framework cookie/request selection and getDb composition are substituted.
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { canonicalJson } from "../canonical-json";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { issueWebSession, parseWebSession, webSessionHash } from "../auth-session";
import { a2aOrderId, type A2aOrder } from "../a2a/order";
import { a2aResearchPackage } from "../a2a/research-package";
import { accountHistorySchema } from "../a2a/account-history-types";
import { makePayment } from "../payments/payment-gateway";
import type { SqliteAdapter } from "./sqlite-adapter";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("../db", () => ({ getDb: mocks.db }));
vi.mock("../config", async () => ({ config: { jwtSecret: "synthetic-pending-owner-secret",
  networkId: "eip155:5042", profile: (await import("../arc-network-profile")).ARC_MAINNET_PROFILE } }));
import { pendingOwnerRequestSession } from "../a2a/pending-owner-session";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";
import { GET } from "../../app/api/me/jobs/route";

const cookie = new AsyncLocalStorage<string | undefined>();
const wallet = `0x${"a".repeat(40)}`, payer = `0x${"b".repeat(40)}`, payee = `0x${"c".repeat(40)}`;
const secret = "synthetic-pending-owner-secret";
let folder: string, file: string, manifestPath: string, db: SqliteAdapter, seq = 0;
const adapters: SqliteAdapter[] = [];
beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "keryx-owner-atomic-")); file = join(folder, "synthetic.sqlite");
  const identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1" as const,
    network: "eip155:5042" as const, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const setup = new DatabaseSync(file);
  try {
    setup.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(setup); installNativeUserDomainSchema(setup);
    insertStorageIdentity(setup, identity); installStorageFences(setup, identity); setup.exec("COMMIT");
  } finally { setup.close(); }
  const manifest = join(folder, "deployment.json");
  manifestPath = manifest;
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  db = await createEnrolledSqliteAdapter(); adapters.push(db);
  mocks.db.mockImplementation(async () => db);
  mocks.cookies.mockImplementation(async () => ({ get: (name: string) => name === "keryx_session" && cookie.getStore() ? { value: cookie.getStore() } : undefined }));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => { for (const adapter of adapters) { try { adapter.close(); } catch {} } rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function order(): A2aOrder {
  const authorizationId = `synthetic-${++seq}`, id = a2aOrderId({ network: "eip155:5042", payer, payee, authorizationId });
  const now = new Date().toISOString();
  return { id, queryId: id, authorizationId, requestHash: "d".repeat(64), payer, payee,
    amountUsdc: 0.05, creatorBudgetUsdc: 0.03, serviceFeeUsdc: 0.02, researchMode: "quick", researchPackage: a2aResearchPackage("quick"),
    status: "running", transaction: `synthetic-tx-${seq}`, request: { question: "private-worker-input", origin: "a2a", network: "eip155:5042" },
    startedAt: null, workerId: null, executionJournalVersion: 1, paymentStartedAt: null, resultSavingAt: null,
    response: null, errorCode: null, resolution: null, createdAt: now, updatedAt: now };
}
const request = () => new Request("https://keryx.test/api/agent/ask", { method: "POST", headers: { origin: "https://keryx.test", "x-keryx-account-job": "associate" } });
async function proof(token: string, original: A2aOrder) {
  return cookie.run(token, () => pendingOwnerRequestSession(request(), { id: original.id, requestHash: original.requestHash }));
}
async function session(owner = wallet) { return (await issueWebSession(db, secret, owner, "asker")).token; }
async function jobs(token: string, id?: string) {
  return cookie.run(token, () => GET(new Request(`https://keryx.test/api/me/jobs?pending=owned${id ? `&id=${id}` : ""}`)));
}
function counts(id: string) {
  const inspect = new DatabaseSync(file, { readOnly: true });
  try { return [inspect.prepare("SELECT count(*) n FROM a2a_orders WHERE id=?").get(id)!.n,
    inspect.prepare("SELECT count(*) n FROM pending_job_owners WHERE job_id=?").get(id)!.n]; }
  finally { inspect.close(); }
}

it("atomically admits a new original for actual cookie owner, not payer; projects no worker text", async () => {
  const token = await session(), original = order();
  const admitted = await db.createOwnedA2aOrder(original, await proof(token, original));
  expect(admitted.created).toBe(true); expect(counts(original.id)).toEqual([1, 1]);
  const packet = await (await jobs(token, original.id)).json();
  expect(packet.jobs).toHaveLength(1); expect(packet.jobs[0].recoveryState).toBe("unknown");
  expect(JSON.stringify(packet)).not.toContain("private-worker-input"); expect(JSON.stringify(packet)).not.toContain(original.authorizationId);
  const foreign = await session(payer);
  expect((await (await jobs(foreign, original.id)).json()).jobs).toEqual([]);
  const ordinaryPacket = await cookie.run(token, () => GET(new Request("https://keryx.test/api/me/jobs")));
  expect(accountHistorySchema.safeParse(await ordinaryPacket.json()).success).toBe(true);
});

it("replayed/unowned originals never get backfilled and one proof cannot be reused", async () => {
  const token = await session(), original = order(); await db.createA2aOrder(original);
  const opaque = await proof(token, original);
  expect((await db.createOwnedA2aOrder(original, opaque)).created).toBe(false);
  expect(counts(original.id)).toEqual([1, 0]);
  await expect(db.createOwnedA2aOrder(original, opaque)).rejects.toThrow("session_unavailable");
});

it("immutable retained ownership refuses literal update/delete even from an identity-fenced writer", async () => {
  const token = await session(), original = order();
  await db.createOwnedA2aOrder(original, await proof(token, original));
  const native = new DatabaseSync(file);
  try {
    registerStorageCapability(native, JSON.parse(readFileSync(manifestPath, "utf8")).identity, () => true);
    expect(() => native.prepare("UPDATE pending_job_owners SET wallet=? WHERE job_id=?").run(payer, original.id)).toThrow("immutable");
    expect(() => native.prepare("DELETE FROM pending_job_owners WHERE job_id=?").run(original.id)).toThrow("immutable");
  } finally { native.close(); }
  expect(counts(original.id)).toEqual([1, 1]);
});

it("two genuine connections competing for the same original retain exactly one immutable owner", async () => {
  const token = await session(), foreign = await session(payer), original = order();
  const firstProof = await proof(token, original), otherProof = await proof(foreign, original);
  const other = await createEnrolledSqliteAdapter(); adapters.push(other);
  const results = await Promise.all([db.createOwnedA2aOrder(original, firstProof), other.createOwnedA2aOrder(original, otherProof)]);
  expect(results.map(r => r.created).sort()).toEqual([false, true]); expect(counts(original.id)).toEqual([1, 1]);
  expect((await (await jobs(token, original.id)).json()).jobs).toHaveLength(1);
  expect((await (await jobs(foreign, original.id)).json()).jobs).toHaveLength(0);
});

it("exact session revocation between JWT verification and admission denies both prepayment and atomic write", async () => {
  const token = await session(), original = order(), opaque = await proof(token, original);
  const claims = (await parseWebSession(token, secret))!;
  await db.revokeWebSession(webSessionHash(claims.jti), wallet);
  expect(() => db.pendingJobOwners!.assertAdmission(opaque)).toThrow();
  db = await createEnrolledSqliteAdapter(); adapters.push(db);
  await expect(db.createOwnedA2aOrder(original, opaque)).rejects.toThrow();
  expect(counts(original.id)).toEqual([0, 0]);
  db = await createEnrolledSqliteAdapter(); adapters.push(db);
  expect((await jobs(token)).status).toBe(401);
  expect(await db.getUser(wallet)).toBeNull();
});

it("refuses forged candidates, missing cookies, competing API actors and cross-origin requests", async () => {
  const original = order();
  await expect(db.createOwnedA2aOrder(original, { authenticatedSession: { wallet }, creation: "new" } as never)).rejects.toThrow("session_unavailable");
  await expect(cookie.run(undefined, () => pendingOwnerRequestSession(request(), { id: original.id, requestHash: original.requestHash }))).rejects.toThrow();
  const token = await session();
  const existingHeaders: Record<string, string>[] = [{ origin: "https://foreign.test", "x-keryx-account-job": "associate" },
    { origin: "https://keryx.test", "x-keryx-account-job": "associate", authorization: "Bearer api-key" }];
  for (const headers of existingHeaders) {
    await expect(cookie.run(token, () => pendingOwnerRequestSession(new Request(request().url, { method: "POST", headers }), { id: original.id, requestHash: original.requestHash }))).rejects.toThrow();
  }
  expect(counts(original.id)).toEqual([0, 0]);
});

it("rejects an actually tampered signed cookie and expired originally bound proof", async () => {
  const token = await session(), original = order();
  const parts = token.split(".");
  const changed = JSON.parse(Buffer.from(parts[1], "base64url").toString()); changed.address = payer;
  parts[1] = Buffer.from(JSON.stringify(changed)).toString("base64url");
  await expect(proof(parts.join("."), original)).rejects.toThrow("session_unavailable");
  const opaque = await proof(token, original);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_001);
  await expect(db.createOwnedA2aOrder(original, opaque)).rejects.toThrow("session_unavailable");
  clock.mockRestore(); expect(counts(original.id)).toEqual([0, 0]);
});

it("current-token revocation denies the sealed reader even when original admission remains retained", async () => {
  const token = await session(), original = order();
  await db.createOwnedA2aOrder(original, await proof(token, original));
  const current = await session();
  const readProof = await cookie.run(current, () => pendingOwnerRequestSession(new Request("https://keryx.test/api/me/jobs")));
  const claims = (await parseWebSession(current, secret))!;
  await db.revokeWebSession(webSessionHash(claims.jti), wallet);
  await expect(db.pendingJobOwners!.list(readProof)).rejects.toThrow();
  expect(counts(original.id)).toEqual([1, 1]);
  db = await createEnrolledSqliteAdapter(); adapters.push(db);
  expect((await (await jobs(token, original.id)).json()).jobs).toHaveLength(1);
});

it("genuine native BUSY contention is temporary, creates nothing and cannot duplicate admission", async () => {
  const token = await session(), original = order(), opaque = await proof(token, original);
  const lock = new DatabaseSync(file);
  try {
    lock.exec("BEGIN EXCLUSIVE");
    // The facade verifies storage synchronously before returning its Promise.
    await expect(Promise.resolve().then(() => db.createOwnedA2aOrder(original, opaque))).rejects.toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 5 });
  } finally { lock.exec("ROLLBACK"); lock.close(); }
  expect(counts(original.id)).toEqual([0, 0]);
  const result = await db.createOwnedA2aOrder(original, await proof(token, original));
  expect(result.created).toBe(true); expect(counts(original.id)).toEqual([1, 1]);
});

it("rolls original insertion back if owner insertion fails, without changing payment rows", async () => {
  const token = await session(), original = order(), opaque = await proof(token, original);
  const prepare = DatabaseSync.prototype.prepare;
  const fault = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    if (/^INSERT INTO pending_job_owners/.test(sql.trim())) throw new Error("synthetic-owner-write-loss");
    return prepare.call(this, sql);
  });
  await expect(db.createOwnedA2aOrder(original, opaque)).rejects.toThrow(); fault.mockRestore();
  expect(counts(original.id)).toEqual([0, 0]);
  db = await createEnrolledSqliteAdapter(); adapters.push(db);
});

it.each(["quick", "deep"] as const)("sealed %s failed-original observation is within target and preserves a durable uncertain leg", async mode => {
  const token = await session(), original = { ...order(), researchMode: mode, researchPackage: a2aResearchPackage(mode) };
  original.startedAt = original.createdAt;
  await db.createOwnedA2aOrder(original, await proof(token, original));
  const payment = makePayment({ id: `pending_${original.id}`, kind: "fetch", queryId: original.id,
    sourceId: "synthetic-private-source", sourceName: "Synthetic source", payer: payee, payee: wallet,
    amountUsdc: 0.000001, txHash: null, authorizationId: "synthetic-uncertain-authorization",
    settled: false, settlementStatus: "pending", origin: "a2a", rationale: "Synthetic uncertainty" });
  await db.recordPaymentOnce(payment);
  await db.markA2aOrderPaymentStarted(original.id, new Date().toISOString());
  await db.failA2aOrder(original.id, "research_failed", new Date().toISOString());
  const before = await db.listCreatorPaymentAttemptsByQuery(original.id);
  const packet = await (await jobs(token, original.id)).json();
  expect(packet.jobs[0].attention).toBe("needs_review"); expect(packet.jobs[0].recoveryState).toBe("unknown");
  expect(packet.jobs[0].escalation.state).toBe("within_target");
  expect(["unknown", "payment_boundary_crossed"]).toContain(packet.jobs[0].escalation.creatorPaymentState);
  expect(await db.listCreatorPaymentAttemptsByQuery(original.id)).toEqual(before);
  expect(before[0].settlementStatus).toBe("pending");
});

it("readonly facade rejects mutation before native SQL and preserves its reader", async () => {
  const read = await createReadonlyEnrolledSqliteAdapter(); adapters.push(read);
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
  expect(() => read.createOwnedA2aOrder(order(), {} as never)).toThrow("Readonly");
  expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); prepare.mockRestore(); exec.mockRestore();
  expect(await read.getUser(wallet)).toBeNull();
});

it("uncertain post-COMMIT acknowledgement never ACKs or permits reuse; originals remain durable", async () => {
  const token = await session(), original = order(), opaque = await proof(token, original);
  const old = db;
  try {
    const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
    let ownerInsert = false, acknowledgementLost = false;
    const p = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
      if (/^INSERT INTO pending_job_owners/.test(sql.trim())) ownerInsert = true;
      return prepare.call(this, sql);
    });
    const e = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function(this: DatabaseSync, sql: string) {
      const result = exec.call(this, sql);
      if (sql === "COMMIT" && ownerInsert) { ownerInsert = false; acknowledgementLost = true; throw new Error("synthetic-lost-commit-ack"); }
      return result;
    });
    try {
      // Core closes after uncertain COMMIT; the facade's rejection guard observes that closure.
      await expect(Promise.resolve().then(() => old.createOwnedA2aOrder(original, opaque))).rejects.toThrow("Verified storage connection closed");
      expect(acknowledgementLost).toBe(true);
    } finally { p.mockRestore(); e.mockRestore(); }
    expect(counts(original.id)).toEqual([1, 1]);
    const refusedPrepare = vi.spyOn(DatabaseSync.prototype, "prepare"), refusedExec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      await expect(Promise.resolve().then(() => old.createOwnedA2aOrder(original, opaque))).rejects.toThrow("Verified storage connection closed");
      expect(refusedPrepare).not.toHaveBeenCalled(); expect(refusedExec).not.toHaveBeenCalled();
    } finally { refusedPrepare.mockRestore(); refusedExec.mockRestore(); }
    // Only a genuinely fresh adapter may inspect retained originals; never reopen the old port.
    db = await createEnrolledSqliteAdapter(); adapters.push(db);
    expect(db).not.toBe(old);
    await expect(db.createOwnedA2aOrder(original, opaque)).rejects.toThrow("session_unavailable");
    expect(counts(original.id)).toEqual([1, 1]);
    expect((await db.createOwnedA2aOrder(original, await proof(token, original))).created).toBe(false);
    expect(counts(original.id)).toEqual([1, 1]);
    await expect(Promise.resolve().then(() => old.createOwnedA2aOrder(original, opaque))).rejects.toThrow("Verified storage connection closed");
  } finally {
    // Failure cleanup is outside every assertion: the following case must not mint on a dead port.
    if (db === old) { db = await createEnrolledSqliteAdapter(); adapters.push(db); }
  }
});

it("source-guard failure stays revoked after exact manifest restoration", async () => {
  const token = await session(), original = order(), opaque = await proof(token, original);
  const old = db;
  const before = readFileSync(manifestPath);
  try {
    writeFileSync(manifestPath, "{}");
    await expect(Promise.resolve().then(() => old.createOwnedA2aOrder(original, opaque))).rejects.toThrow("Storage deployment configuration unavailable");
  } finally { writeFileSync(manifestPath, before); }
  const refusedPrepare = vi.spyOn(DatabaseSync.prototype, "prepare"), refusedExec = vi.spyOn(DatabaseSync.prototype, "exec");
  try {
    await expect(Promise.resolve().then(() => old.createOwnedA2aOrder(original, opaque))).rejects.toThrow("Verified storage connection closed");
    expect(refusedPrepare).not.toHaveBeenCalled(); expect(refusedExec).not.toHaveBeenCalled();
  } finally { refusedPrepare.mockRestore(); refusedExec.mockRestore(); }
  expect(counts(original.id)).toEqual([0, 0]);
  db = await createEnrolledSqliteAdapter(); adapters.push(db);
  expect(db).not.toBe(old);
  expect((await db.createOwnedA2aOrder(original, await proof(token, original))).created).toBe(true);
  expect(counts(original.id)).toEqual([1, 1]);
  await expect(Promise.resolve().then(() => old.createOwnedA2aOrder(original, opaque))).rejects.toThrow("Verified storage connection closed");
});


// UNRUN current-main498 composition controls. Extend this existing genuine
// enrolled/JWT/native-reader fixture; no substitute proof or owner port.
it("keeps default payer history distinct with a genuine pending port present", async () => {
  const owner = `0x${"d".repeat(40)}`, token = await session(owner), owned = order();
  expect(db.pendingJobOwners).toBeDefined();
  expect((await db.createOwnedA2aOrder(owned, await proof(token, owned))).created).toBe(true);
  const legacy = { ...order(), payer: owner };
  legacy.id = legacy.queryId = a2aOrderId({ network: "eip155:5042", payer: owner, payee, authorizationId: legacy.authorizationId });
  await db.createA2aOrder(legacy);
  const prepare = DatabaseSync.prototype.prepare, sql: string[] = [];
  const trace = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, statement: string) {
    sql.push(statement); return prepare.call(this, statement);
  });
  try {
    // id remains only a selector for the explicit owned path. Other pending
    // values retain incoming payer history rather than implicitly opting in.
    for (const query of ["", `?id=${owned.id}`, "?pending=other"]) {
      sql.length = 0;
      const response = await cookie.run(token, () => GET(new Request(`https://keryx.test/api/me/jobs${query}`)));
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
      const raw = await response.json(), packet = accountHistorySchema.parse(raw);
      expect(packet.jobs.map(row => row.id)).toEqual([legacy.id]);
      expect(raw).not.toHaveProperty("ownership"); expect(raw).not.toHaveProperty("recoveryState");
      expect(sql.some(value => /SELECT \* FROM a2a_orders WHERE LOWER\(payer\)/.test(value))).toBe(true);
      expect(sql.some(value => /FROM pending_job_owners p JOIN/.test(value))).toBe(false);
    }
    sql.length = 0;
    const response = await jobs(token);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const packet = await response.json();
    expect(packet).toMatchObject({ ownership: "authenticated_original", recoveryState: "unknown" });
    expect(packet.jobs.map((row: { id: string }) => row.id)).toEqual([owned.id]);
    expect(packet.jobs[0]).toMatchObject({ question: null, recoveryState: "unknown" });
    expect(sql.some(value => /FROM pending_job_owners p JOIN/.test(value))).toBe(true);
    expect(sql.some(value => /SELECT \* FROM a2a_orders WHERE LOWER\(payer\)/.test(value))).toBe(false);
    expect(JSON.stringify(packet)).not.toContain("private-worker-input");
    expect(JSON.stringify(packet)).not.toContain(owned.authorizationId);
  } finally { trace.mockRestore(); }
});

it("pages native owned rows at equal timestamps without payer-only or foreign originals", async () => {
  const owner = `0x${"e".repeat(40)}`, token = await session(owner), timestamp = new Date().toISOString();
  const originals = Array.from({ length: 27 }, () => ({ ...order(), createdAt: timestamp, updatedAt: timestamp }));
  const seed = originals[0];
  expect((await db.createOwnedA2aOrder(seed, await proof(token, seed))).created).toBe(true);
  // Pagination fixture only: one genuine atomic admission, then equivalent
  // synthetic retained rows in this isolated database. This does not exercise
  // or claim 27 authenticated producer admissions; their controls stay separate.
  const fixtureWriter = new DatabaseSync(file);
  try {
    registerStorageCapability(fixtureWriter, JSON.parse(readFileSync(manifestPath, "utf8")).identity, () => true);
    fixtureWriter.exec("BEGIN IMMEDIATE");
    const copyOriginal = fixtureWriter.prepare(`INSERT INTO a2a_orders
      (id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,
       service_fee_usdc,research_mode,package_data,status,transaction_id,request_data,started_at,worker_id,
       execution_journal_version,payment_started_at,result_saving_at,response_data,error_code,resolution_data,
       created_at,updated_at)
      SELECT ?,?,?,request_hash,payer,payee,amount_usdc,creator_budget_usdc,
       service_fee_usdc,research_mode,package_data,status,?,request_data,started_at,worker_id,
       execution_journal_version,payment_started_at,result_saving_at,response_data,error_code,resolution_data,
       created_at,updated_at FROM a2a_orders WHERE id=?`);
    const copyOwner = fixtureWriter.prepare(`INSERT INTO pending_job_owners
      (job_id,query_id,request_hash,network,wallet,session_hash,issued_at,expires_at,admitted_at)
      SELECT ?,?,request_hash,network,wallet,session_hash,issued_at,expires_at,admitted_at
      FROM pending_job_owners WHERE job_id=?`);
    for (const original of originals.slice(1)) {
      expect(copyOriginal.run(original.id, original.queryId, original.authorizationId, original.transaction, seed.id).changes).toBe(1);
      expect(copyOwner.run(original.id, original.queryId, seed.id).changes).toBe(1);
    }
    fixtureWriter.exec("COMMIT");
  } finally { fixtureWriter.close(); }
  const unowned = order(); await db.createA2aOrder(unowned);
  const foreignToken = await session(payee), foreignOriginal = order();
  await db.createOwnedA2aOrder(foreignOriginal, await proof(foreignToken, foreignOriginal));
  const readPage = (query: string) => cookie.run(token, () => GET(new Request(`https://keryx.test/api/me/jobs?pending=owned${query}`)));
  const firstResponse = await readPage("");
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json();
  expect(first.jobs).toHaveLength(25); expect(typeof first.nextCursor).toBe("string");
  // Decode the actual route cursor using the existing real parser below.
  const { decodeHistoryCursor } = await import("../a2a/account-history");
  expect(decodeHistoryCursor(first.nextCursor)).toEqual({ createdAt: timestamp, id: first.jobs[24].id });
  const secondResponse = await readPage(`&cursor=${encodeURIComponent(first.nextCursor)}`);
  expect(secondResponse.status).toBe(200);
  const second = await secondResponse.json();
  expect(second.jobs).toHaveLength(2); expect(second.nextCursor).toBeNull();
  const ids = [...first.jobs, ...second.jobs].map((row: { id: string }) => row.id);
  expect(ids).toEqual(originals.map(row => row.id).sort().reverse());
  expect(new Set(ids).size).toBe(27);
  expect(ids).not.toContain(unowned.id); expect(ids).not.toContain(foreignOriginal.id);
  for (const id of [unowned.id, foreignOriginal.id]) {
    const response = await readPage(`&id=${id}`);
    expect(response.status).toBe(200); expect((await response.json()).jobs).toEqual([]);
  }
  expect((await readPage("&cursor=bad!")).status).toBe(400);
  expect((await readPage("&id=caller-controlled")).status).toBe(503);
});

it.each(["cookie-lost", "native-read-fault"] as const)("refuses %s during owned composition without falling back to payer history", async failure => {
  const token = await session(), original = order();
  await db.createOwnedA2aOrder(original, await proof(token, original));
  const cookieImplementation = mocks.cookies.getMockImplementation()!;
  let cookieReads = 0, payerReads = 0, ownedReads = 0;
  if (failure === "cookie-lost") {
    // Only request-local framework selection changes; both verifier passes
    // otherwise use the real signed cookie and durable session implementation.
    mocks.cookies.mockImplementation(async (...args) => ++cookieReads === 1
      ? cookieImplementation(...args) : { get: () => undefined });
  }
  const prepare = DatabaseSync.prototype.prepare;
  const fault = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    if (/SELECT \* FROM a2a_orders WHERE LOWER\(payer\)/.test(sql)) payerReads++;
    if (/FROM pending_job_owners p JOIN/.test(sql)) {
      ownedReads++;
      if (failure === "native-read-fault") throw new Error("synthetic owned-reader SQL failure");
    }
    return prepare.call(this, sql);
  });
  try {
    const response = await jobs(token, original.id);
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Paid job history is unavailable. Please retry." });
    expect(payerReads).toBe(0); expect(ownedReads).toBe(failure === "cookie-lost" ? 0 : 1);
  } finally {
    fault.mockRestore(); mocks.cookies.mockImplementation(cookieImplementation);
    // A genuine native SQL failure retires the reader; preserve that refusal.
    if (failure === "native-read-fault") { db = await createEnrolledSqliteAdapter(); adapters.push(db); }
  }
  expect(counts(original.id)).toEqual([1, 1]);
});
