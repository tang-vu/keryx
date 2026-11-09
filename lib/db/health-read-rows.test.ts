import { afterEach, expect, it } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { readSqlitePublicHealthSnapshot } from "./health-read-rows";
import { publicHealthSyncKeys } from "./public-health-snapshot";
import { completionFixtureRows, COMPLETION_FIXTURE_NOW } from "../a2a/completion-latency.test-support";

const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
function native(accounts = true) {
  const db = new DatabaseSync(":memory:"); opened.push(db);
  db.exec(`CREATE TABLE payment_events(amount_usdc,source_id,query_id,kind,origin,settled,settlement_status,payer,tx_hash);
    CREATE TABLE query_runs(id,origin,asker,duration_ms,payment_mode,payment_attempts,settled_payments,confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,rewarded_citation_count);
    CREATE TABLE answer_feedback(query_id,rating); CREATE TABLE gap_intents(status);
    CREATE TABLE a2a_orders(status,created_at,updated_at,started_at,execution_journal_version,package_data,response_data,resolution_data);
    CREATE TABLE sync_state(key PRIMARY KEY,value);`);
  if (accounts) db.exec("CREATE TABLE users(wallet_address)");
  return db;
}
function insert(db: DatabaseSync, table: string, values: SQLInputValue[]) {
  // All names are fixed test source, not application arguments.
  db.prepare(`INSERT INTO ${table} VALUES(${values.map(() => "?").join(",")})`).run(...values);
}
async function legacy(db: DatabaseSync, includeRegistry = true) {
  // Unchanged ordinary methods are only a native-value/output oracle here.
  // Genuine enrolled admission and revocation are tested in the separate suite.
  const core = { db };
  return {
    metrics: await Reflect.apply(SqliteAdapter.prototype.metrics, core, []),
    jobs: await Reflect.apply(SqliteAdapter.prototype.a2aOperationsSnapshot, core, [COMPLETION_FIXTURE_NOW]),
    syncState: await Reflect.apply(SqliteAdapter.prototype.getSyncStates, core, [publicHealthSyncKeys(includeRegistry)]),
  };
}

it.each([true, false])("preserves empty native rows and the independent optional account boundary (%s)", async accounts => {
  const db = native(accounts);
  const snapshot = await readSqlitePublicHealthSnapshot(db, COMPLETION_FIXTURE_NOW, true);
  expect(snapshot).toEqual(await legacy(db));
  expect(snapshot.metrics.recordedAccounts).toBe(accounts ? 0 : null);
  expect([...snapshot.syncState]).toEqual(publicHealthSyncKeys(true).map(key => [key, null]));
});

it("preserves mixed metric values, all completion cohorts, native blobs and the unconfigured registry shape", async () => {
  const db = native();
  insert(db, "payment_events", [0.1, "source1", "q1", "citation", "web", 1, "settled", "PRIVATE_PAYER", "synthetic"]);
  insert(db, "query_runs", ["q1", "web", null, 123, "offline", 0, 0, "Low", null, 3, 1, 0]);
  insert(db, "answer_feedback", ["q1", "up"]); insert(db, "gap_intents", ["open"]);
  insert(db, "users", ["0x" + "ab".repeat(20)]); insert(db, "users", ["0x" + "AB".repeat(20)]);
  insert(db, "sync_state", ["lastSyncedBlock", "123"]);
  insert(db, "sync_state", ["dispatchHealth", new Uint8Array([49, 50])]);
  insert(db, "sync_state", ["a2aWorker", JSON.stringify({ status: "idle", updatedAt: "2026-10-09T00:00:00Z", workerId: "PRIVATE_WORKER" })]);
  for (const row of completionFixtureRows()) insert(db, "a2a_orders", [row.status, row.createdAt, row.updatedAt,
    row.startedAt, row.executionJournalVersion as SQLInputValue ?? null, JSON.stringify(row.researchPackage ?? null),
    JSON.stringify({ answer: "PRIVATE_ANSWER", serviceReceipt: row.serviceReceipt }), row.resolution == null ? null : JSON.stringify(row.resolution)]);
  const rows = db.prepare("SELECT * FROM a2a_orders").all();
  for (const registry of [true, false]) {
    const combined = await readSqlitePublicHealthSnapshot(db, COMPLETION_FIXTURE_NOW, registry);
    expect(combined).toEqual(await legacy(db, registry));
    expect(combined.metrics.recordedAccounts).toBe(1);
    expect(JSON.stringify(combined.jobs)).not.toMatch(/PRIVATE_|claimId|serviceReceipt|authoritySha256/);
    expect(combined.syncState.has("lastSyncedBlock")).toBe(registry);
  }
  expect(db.prepare("SELECT * FROM a2a_orders").all()).toEqual(rows);
});

it("retains malformed/scalar package and recovery classification instead of guessing provenance", async () => {
  const db = native();
  for (const row of completionFixtureRows()) insert(db, "a2a_orders", [row.status, row.createdAt, row.updatedAt,
    row.startedAt, row.executionJournalVersion as SQLInputValue ?? null, JSON.stringify(row.researchPackage ?? null),
    JSON.stringify({ serviceReceipt: row.serviceReceipt }), row.resolution == null ? null : JSON.stringify(row.resolution)]);
  db.prepare("UPDATE a2a_orders SET package_data=?,response_data=?,resolution_data=? WHERE rowid=1")
    .run("not-json", JSON.stringify({ serviceReceipt: "PRIVATE_SCALAR" }), "not-json");
  const malformed = await readSqlitePublicHealthSnapshot(db, COMPLETION_FIXTURE_NOW, true);
  expect(malformed).toEqual(await legacy(db));
  expect(JSON.stringify(malformed.jobs)).not.toContain("PRIVATE_SCALAR");
  const row = completionFixtureRows()[2];
  db.prepare("UPDATE a2a_orders SET resolution_data=? WHERE rowid=3")
    .run(JSON.stringify({ ...(row.resolution as object), actor: ["operator-cli"] }));
  expect(await readSqlitePublicHealthSnapshot(db, COMPLETION_FIXTURE_NOW, true)).toEqual(await legacy(db));
});

it("retains native integer-read refusal for mandatory job inputs", async () => {
  const db = native(), row = completionFixtureRows()[0];
  insert(db, "a2a_orders", [row.status, row.createdAt, row.updatedAt, row.startedAt, BigInt(1) << BigInt(60), null, null, null]);
  await expect(readSqlitePublicHealthSnapshot(db, COMPLETION_FIXTURE_NOW, true)).rejects.toThrow();
  await expect(Reflect.apply(SqliteAdapter.prototype.a2aOperationsSnapshot, { db }, [COMPLETION_FIXTURE_NOW])).rejects.toThrow();
});

it("returns a fresh fixed-key snapshot after later writes without changing earlier results", async () => {
  const db = native(); insert(db, "sync_state", ["a2aWorker", "first"]);
  const first = await readSqlitePublicHealthSnapshot(db, COMPLETION_FIXTURE_NOW, true);
  db.prepare("UPDATE sync_state SET value=? WHERE key=?").run("second", "a2aWorker");
  const second = await readSqlitePublicHealthSnapshot(db, COMPLETION_FIXTURE_NOW, true);
  expect(first.syncState.get("a2aWorker")).toBe("first"); expect(second.syncState.get("a2aWorker")).toBe("second");
  expect(second).toEqual(await legacy(db));
});
