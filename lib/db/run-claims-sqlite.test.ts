import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { createSqliteRunClaims, RUN_CLAIMS_SQL } from "./run-claims-sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { writeSqliteQueryRun } from "./query-run-record";
import { SqliteAdapter } from "./sqlite-adapter";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { requireRunClaims, RUN_CLAIM_TTL_MS, type RunClaimAttempt, type RunClaimBinding } from "../run-claims/contracts";
import type { QueryRun } from "../types";

const connections: DatabaseSync[] = [], adapters: SqliteAdapter[] = [], directories: string[] = [];
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, hash = (value: string) => createHash("sha256").update(value).digest("hex");
const binding: RunClaimBinding = { network: "eip155:5042002", origin: "https://synthetic-claims.example" };
const stamp = Date.parse("2026-10-11T00:00:00.000Z");
afterEach(() => {
  vi.unstubAllEnvs();
  for (const db of connections.splice(0)) db.close();
  for (const adapter of adapters.splice(0)) adapter.close();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !directory.includes("keryx-run-claims-")) throw new Error("Unsafe fixture cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "keryx-run-claims-")); directories.push(directory);
  const path = join(directory, "ordinary.sqlite"), db = new DatabaseSync(path); connections.push(db);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
  installSqliteApplicationSchema(db); db.exec(RUN_CLAIMS_SQL);
  let now = stamp;
  const store = createSqliteRunClaims(db, { fixtureClock: () => now });
  for (const wallet of [alice, bob]) db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
    .run(hash(wallet), wallet, stamp - 1000, stamp + 2 * RUN_CLAIM_TTL_MS);
  const run = (id = "new-run", extra: Partial<QueryRun> = {}): QueryRun => ({ id, question: "Synthetic claim", budget: 0,
    engine: "heuristic", subClaims: [], decisions: [], citations: [], answer: "Fixture answer", totalSpent: 0,
    totalToCreators: 0, trace: [], createdAt: new Date(stamp).toISOString(), paymentMode: "offline", ...extra });
  const save = (id = "new-run", extra: Partial<QueryRun> = {}) => { const value = run(id, extra); writeSqliteQueryRun(db, value, false); return value; };
  const issue = (id = "new-run", tokenHash = hash(id)) => store.issue({ runId: id, completedAt: new Date(stamp).toISOString(), tokenHash, binding });
  const attempt = (wallet = alice, tokenHash = hash("new-run")) => ({ tokenHash, wallet, sessionHash: hash(wallet), binding });
  return { db, path, store, run, save, issue, attempt, setNow: (value: number) => { now = value; } };
}
type Outcome = { won: boolean; code?: string; wallet?: string };
function claimWorker(path: string, attempt: RunClaimAttempt, barrier: SharedArrayBuffer, onReady: () => void, onAttempting = () => {}) {
  const source = `const { parentPort,workerData }=require('node:worker_threads');
    (async()=>{ const {DatabaseSync}=require('node:sqlite'); const {fileURLToPath}=require('node:url');
    const {require:tsxRequire}=require(fileURLToPath(workerData.loader));
    const {createSqliteRunClaims}=tsxRequire(fileURLToPath(workerData.module),workerData.module);
    const db=new DatabaseSync(workerData.path); db.exec('PRAGMA busy_timeout=5000');
    try { const store=createSqliteRunClaims(db,{fixtureClock:()=>workerData.now}); const gate=new Int32Array(workerData.barrier);
      parentPort.postMessage({ready:true}); Atomics.wait(gate,0,0,10000);
      if(Atomics.load(gate,0)!==1)throw Error('Fixture start barrier timed out');
      parentPort.postMessage({attempting:true});
      try { await store.claim(workerData.attempt); parentPort.postMessage({won:true,wallet:workerData.attempt.wallet}); }
      catch(error) { parentPort.postMessage({won:false,code:error.code}); }
    } finally {db.close();} })().catch(error=>{parentPort.postMessage({fatal:String(error)});process.exitCode=1;});`;
  const worker = new Worker(source, { eval: true, execArgv: [], workerData: {
    module: new URL("./run-claims-sqlite.ts", import.meta.url).href, loader: import.meta.resolve("tsx/cjs/api"),
    path, now: stamp, barrier, attempt,
  } });
  const outcome = new Promise<Outcome>((resolveOutcome, reject) => {
    let result: Outcome | undefined;
    worker.on("message", value => {
      if (value.ready) onReady(); else if (value.attempting) onAttempting();
      else if (value.fatal) reject(new Error(value.fatal)); else result = value;
    });
    worker.on("error", reject);
    worker.on("exit", code => code === 0 && result ? resolveOutcome(result) : reject(new Error("Fixture worker did not close successfully")));
  });
  return { worker, outcome };
}
function release(barrier: SharedArrayBuffer, count = 1) {
  Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0, count);
}
describe("ordinary existing-schema anonymous claims", () => {
  it("default-off/nonenumerable assembly never creates or repairs the domain", async () => {
    const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter); await adapter.init();
    expect(adapter.runClaims).toBeUndefined(); const db = Reflect.get(adapter, "db") as DatabaseSync;
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='anonymous_run_claims'").get()).toBeUndefined();
    vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); await adapter.init(); expect(adapter.runClaims).toBeUndefined();
    db.exec(RUN_CLAIMS_SQL); await adapter.init(); expect(adapter.runClaims).toBeDefined(); expect(Object.keys(adapter)).not.toContain("runClaims");
    expect(Object.getOwnPropertyNames(SqliteAdapter.prototype)).not.toContain("runClaims");
    const malformed = new SqliteAdapter(":memory:"); adapters.push(malformed);
    const second = Reflect.get(malformed, "db") as DatabaseSync; second.exec("CREATE TABLE anonymous_run_claims(unknown TEXT)");
    await malformed.init(); expect(malformed.runClaims).toBeUndefined(); expect(second.prepare("PRAGMA table_info(anonymous_run_claims)").all().map(row => row.name)).toEqual(["unknown"]);
  });
  it("issues one fixed24h hashed ticket and changes only ownership sidecar fields", async () => {
    const f = fixture(); f.save();
    // Synthetic payment/settlement/authorization rows must remain byte-identical. A claim
    // is ownership only, even when the original contains treasury-funded evidence.
    f.db.prepare(`INSERT INTO payment_events(id,query_id,payer,payee,amount_usdc,settled,settlement_status,authorization_id,tx_hash)
      VALUES('synthetic-payment','new-run',?,?,0,0,'simulated','synthetic-auth','synthetic-tx')`).run(bob, alice);
    f.db.prepare(`INSERT INTO session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch)
      VALUES(?,?,?,1,0,?,'synthetic-grant','synthetic-epoch')`).run(bob, alice, bob, stamp + RUN_CLAIM_TTL_MS);
    f.db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at)
      VALUES('synthetic-other-order','other-owned-run','synthetic-auth','synthetic-request',?,?,0,0,0,'deep','completed','synthetic-order-tx',?,?)`).run(bob, alice, new Date(stamp).toISOString(), new Date(stamp).toISOString());
    const financialTables = ["payment_events", "session_grants", "a2a_orders", "browser_authorization_intents", "web_sessions"];
    const financialSnapshot = () => JSON.stringify(financialTables.map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
    const financialBefore = financialSnapshot(), before = f.db.prepare("SELECT * FROM query_runs").all(), schema = f.db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all();
    const issued = await f.issue(); expect(Date.parse(issued.expiresAt) - Date.parse(issued.issuedAt)).toBe(RUN_CLAIM_TTL_MS);
    const retained = f.db.prepare("SELECT * FROM anonymous_run_claims").get()!;
    expect(retained.token_hash).toBe(hash("new-run")); expect(retained.original_sha256).toBe(hash(String(before[0].data)));
    expect(Object.keys(retained)).toEqual(["run_id", "network", "origin", "token_hash", "original_sha256", "completed_at", "issued_at", "expires_at", "claimed_wallet", "claimed_at"]);
    await expect(f.issue()).rejects.toThrow(/^claim_unavailable$/); f.setNow(stamp + 1000);
    const claimed = await f.store.claim(f.attempt()); expect(claimed).toEqual({ version: 1, runId: "new-run", wallet: alice, binding, claimedAt: new Date(stamp + 1000).toISOString() });
    expect(f.db.prepare("SELECT * FROM query_runs").all()).toEqual(before); expect(financialSnapshot()).toBe(financialBefore);
    expect(f.db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
    for (const wallet of [alice, bob]) await expect(f.store.claim(f.attempt(wallet))).rejects.toThrow(/^claim_unavailable$/);
    expect(() => f.db.exec("DELETE FROM anonymous_run_claims")).toThrow("claim_unavailable");
    expect(() => f.db.prepare("UPDATE anonymous_run_claims SET claimed_wallet=?").run(bob)).toThrow("claim_unavailable");
    expect(() => f.db.prepare("UPDATE anonymous_run_claims SET token_hash=?").run(hash("replacement"))).toThrow("claim_unavailable");
  });
  it.each(["indexed-owner", "json-owner", "original", "browser", "paid-order", "missing", "completed-mismatch"])("refuses %s originals without a ticket", async mutant => {
    const f = fixture();
    if (mutant !== "missing") f.save("new-run", mutant === "original" ? { originalFulfillment: {} as NonNullable<QueryRun["originalFulfillment"]> }
      : mutant === "browser" ? { askerFunded: true } : {});
    if (mutant === "indexed-owner") f.db.prepare("UPDATE query_runs SET asker=? WHERE id='new-run'").run(alice);
    if (mutant === "json-owner") f.db.exec(`UPDATE query_runs SET data=json_set(data,'$.asker','${alice}')`);
    if (mutant === "completed-mismatch") f.db.exec("UPDATE query_runs SET created_at='2026-10-10T00:00:00.000Z'");
    if (mutant === "paid-order") f.db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at)
      VALUES('paid','new-run','fixture','fixture',?,?,0,0,0,'deep','completed','fixture',?,?)`).run(alice, bob, new Date(stamp).toISOString(), new Date(stamp).toISOString());
    await expect(f.issue()).rejects.toThrow(/^claim_unavailable$/); expect(f.db.prepare("SELECT count(*) AS n FROM anonymous_run_claims").get()?.n).toBe(0);
  });
  it("unknown, expired, used, owned and modified-original tickets have one refusal", async () => {
    const f = fixture(); f.save(); await f.issue();
    await expect(f.store.claim(f.attempt(alice, hash("unknown")))).rejects.toThrow(/^claim_unavailable$/);
    f.setNow(stamp + RUN_CLAIM_TTL_MS); await expect(f.store.claim(f.attempt())).rejects.toThrow(/^claim_unavailable$/); f.setNow(stamp);
    const original = String(f.db.prepare("SELECT data FROM query_runs").get()?.data);
    f.db.exec(`UPDATE query_runs SET data=json_set(data,'$.answer','changed')`); await expect(f.store.claim(f.attempt())).rejects.toThrow(/^claim_unavailable$/);
    f.db.prepare("UPDATE query_runs SET data=?,asker=?").run(original, alice); await expect(f.store.claim(f.attempt())).rejects.toThrow(/^claim_unavailable$/);
    f.db.prepare("UPDATE query_runs SET asker=NULL").run(); await f.store.claim(f.attempt());
    await expect(f.store.claim(f.attempt())).rejects.toThrow(/^claim_unavailable$/);
  });
  it("rechecks owner/session revocation/expiry under the claim transaction", async () => {
    const f = fixture(); f.save(); await f.issue();
    for (const sessionHash of [hash("unknown-session"), hash(bob)]) await expect(f.store.claim({ ...f.attempt(), sessionHash })).rejects.toThrow(/^claim_unauthenticated$/);
    f.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(hash(alice)); await expect(f.store.claim(f.attempt())).rejects.toThrow(/^claim_unauthenticated$/);
    f.db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(hash(alice), alice, stamp - 1000, stamp);
    await expect(f.store.claim(f.attempt())).rejects.toThrow(/^claim_unauthenticated$/);
    expect(f.db.prepare("SELECT claimed_wallet FROM anonymous_run_claims").get()?.claimed_wallet).toBeNull();
  });
  it("network/origin mismatch cannot consume the original", async () => {
    const f = fixture(); f.save(); await f.issue();
    for (const changed of [{ ...binding, network: "eip155:5042" as const }, { ...binding, origin: "https://other.example" }])
      await expect(f.store.claim({ ...f.attempt(), binding: changed })).rejects.toThrow(/^claim_unavailable$/);
    await f.store.claim(f.attempt());
  });
  it("unknown domain/session triggers refuse before writes, with no repair", async () => {
    const f = fixture(); f.save(); await f.issue(); const before = f.db.prepare("SELECT * FROM anonymous_run_claims").all();
    f.db.exec("CREATE TRIGGER adverse_claim AFTER UPDATE ON anonymous_run_claims BEGIN DELETE FROM query_runs; END;");
    const schema = f.db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all();
    await expect(f.store.claim(f.attempt())).rejects.toThrow(/^claims_unavailable$/);
    expect(f.db.prepare("SELECT * FROM anonymous_run_claims").all()).toEqual(before); expect(f.db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
  });
  it("enrolled cores omit the port and existing ordinary ports refuse later enrollment", async () => {
    const f = fixture(), core = SqliteAdapter.assembleConnectionCore(f.db, syntheticStorageIdentity("testnet-offline"), () => {});
    expect(Object.hasOwn(core, "runClaims")).toBe(false); expect(() => requireRunClaims(core)).toThrow(/^claims_unavailable$/);
    f.db.exec("CREATE TABLE keryx_storage_identity(id TEXT)"); const before = f.db.prepare("SELECT * FROM anonymous_run_claims").all();
    await expect(f.store.assertAvailable()).rejects.toThrow(/^claims_unavailable$/); await expect(f.issue()).rejects.toThrow(/^claims_unavailable$/);
    expect(f.db.prepare("SELECT * FROM anonymous_run_claims").all()).toEqual(before);
  });
  it("two independent worker connections race one ticket: exactly one wallet wins", async () => {
    const f = fixture(); f.save(); await f.issue(); f.db.exec("PRAGMA busy_timeout=5000");
    const barrier = new SharedArrayBuffer(4);
    let ready = 0;
    const workers = [alice, bob].map(wallet => claimWorker(f.path, f.attempt(wallet), barrier, () => { if (++ready === 2) release(barrier, 2); }));
    try {
      const results = await Promise.all(workers.map(value => value.outcome)); expect(results.filter(value => value.won)).toHaveLength(1);
      expect(results.filter(value => !value.won)).toEqual([{ won: false, code: "claim_unavailable" }]);
      expect(f.db.prepare("SELECT claimed_wallet FROM anonymous_run_claims").get()?.claimed_wallet).toBe(results.find(value => value.won)?.wallet);
    } finally { await Promise.all(workers.map(value => value.worker.terminate())); }
  });
  it("a queued claimant sees durable session revocation committed by the lock holder", async () => {
    const f = fixture(); f.save(); await f.issue(); f.db.exec("BEGIN IMMEDIATE");
    f.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(hash(alice));
    const barrier = new SharedArrayBuffer(4);
    let commit: ReturnType<typeof setTimeout> | undefined, locked = true;
    const pending = claimWorker(f.path, f.attempt(), barrier, () => release(barrier), () => {
      // Give the worker time to reach BEGIN IMMEDIATE while this connection owns it.
      commit = setTimeout(() => { f.db.exec("COMMIT"); locked = false; }, 100);
    });
    try {
      expect(await pending.outcome).toEqual({ won: false, code: "claim_unauthenticated" });
      expect(f.db.prepare("SELECT claimed_wallet FROM anonymous_run_claims").get()?.claimed_wallet).toBeNull();
    } finally {
      if (commit) clearTimeout(commit); if (locked) f.db.exec("ROLLBACK"); await pending.worker.terminate();
    }
  });
});
