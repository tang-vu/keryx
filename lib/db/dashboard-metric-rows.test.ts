import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { SqliteAdapter } from "./sqlite-adapter";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { STORAGE_MAINNET_PROFILE_DIGEST, validateStorageIdentity } from "./storage-identity";
import type { NativeReadCounts } from "../../scripts/measure-enrolled-health.mjs";

const close: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const cleanup of close.splice(0).reverse()) cleanup();
  vi.unstubAllEnvs();
});

function nativeRows(accounts = true) {
  const db = new DatabaseSync(":memory:"); close.push(() => db.close());
  db.exec(`CREATE TABLE payment_events(amount_usdc,source_id,query_id,kind,origin,settled,settlement_status,payer,tx_hash);
    CREATE TABLE query_runs(id,origin,asker,duration_ms,payment_mode,payment_attempts,settled_payments,confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,rewarded_citation_count);
    CREATE TABLE answer_feedback(query_id,rating); CREATE TABLE gap_intents(status);`);
  if (accounts) db.exec("CREATE TABLE users(wallet_address)");
  return db;
}

// Actual unchanged core method is a native-value/output oracle only. It does not
// qualify enrollment; separate genuine readonly facade tests below cover guards.
const originalMetrics = (db: DatabaseSync) => Reflect.apply(SqliteAdapter.prototype.metrics, { db }, []) as ReturnType<SqliteAdapter["metrics"]>;
async function fusedMetrics(db: DatabaseSync) {
  const { readSqliteDashboardMetrics } = await import("./dashboard-metric-rows");
  return readSqliteDashboardMetrics(db);
}
function insert(db: DatabaseSync, table: string, values: SQLInputValue[]) {
  // All names are source-owned test literals; production helper accepts no SQL.
  db.prepare(`INSERT INTO ${table} VALUES(${values.map(() => "?").join(",")})`).run(...values);
}

async function genuine() {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "dashboard-metric-rows-")); close.push(() => rmSync(folder, { recursive: true }));
  const file = join(folder, "synthetic.sqlite"), manifest = join(folder, "deployment.json");
  const identity = validateStorageIdentity({ format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042",
    profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: "2026-10-05T00:00:00.000Z", provenanceDigest: "11".repeat(32) });
  const native = new DatabaseSync(file);
  try {
    native.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(native);
    insertStorageIdentity(native, identity); installStorageFences(native, identity); native.exec("COMMIT");
  } finally { native.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  const api = await import("./enrolled-sqlite-adapter");
  const reader = await api.createReadonlyEnrolledSqliteAdapter(); close.push(() => reader.close());
  return { file, manifest, reader, api };
}

it("uses one native input SELECT and one optional account SELECT through the genuine readonly facade", async () => {
  const { file, reader, api } = await genuine(); const before = readFileSync(file);
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const metrics = await reader.metrics();
  const sql = prepare.mock.calls.map(([statement]) => statement.replace(/\s+/g, " ").trim());
  const inputs = sql.filter(statement => /^SELECT (?:0 AS metric_group|amount_usdc,source_id|id,origin,asker|query_id,rating|status FROM gap_intents)/.test(statement));
  const counts: NativeReadCounts = { nativePrepares: sql.length, metricInputReads: inputs.length,
    accountReads: sql.filter(statement => statement.startsWith("SELECT COUNT(DISTINCT LOWER(wallet_address))")).length,
    jobReads: sql.filter(statement => statement.startsWith("SELECT status,created_at,updated_at,started_at,execution_journal_version")).length,
    syncReads: sql.filter(statement => statement.startsWith("SELECT key, value FROM sync_state WHERE")).length,
    schemaReads: sql.filter(statement => statement.includes("FROM sqlite_schema")).length };
  expect(counts.metricInputReads).toBe(1);
  expect(inputs[0]).toContain("UNION ALL");
  expect(counts.accountReads).toBe(1);
  expect(counts.schemaReads).toBeGreaterThan(0);
  expect(api.ENROLLED_SQLITE_METHOD_ACCESS.metrics).toBe("read"); expect(Object.isFrozen(reader)).toBe(true);
  expect(metrics).toMatchObject({ totalQueries: 0, totalPayments: 0, recordedAccounts: 0 });
  expect(readFileSync(file)).toEqual(before);
}, 30_000);

it("keeps later committed account changes fresh without retaining prior result values", async () => {
  const { reader, api } = await genuine(); const first = await reader.metrics();
  const writer = await api.createEnrolledSqliteAdapter(); close.push(() => writer.close());
  const wallet = `0x${"aB".repeat(20)}`; await writer.upsertUser(wallet, "reader"); await writer.upsertUser(wallet.toLowerCase(), "creator");
  expect((await reader.metrics()).recordedAccounts).toBe(1); expect(first.recordedAccounts).toBe(0);
  expect(JSON.stringify(await reader.metrics())).not.toContain(wallet.toLowerCase());
}, 30_000);

it.each(["manifest", "schema"])("refuses fresh %s drift after a successful genuine read", async kind => {
  const { reader, manifest, file } = await genuine(); await reader.metrics();
  if (kind === "manifest") writeFileSync(manifest, "{}");
  else { const native = new DatabaseSync(file); try { native.exec("CREATE TABLE unexpected_metric_drift(value TEXT)"); } finally { native.close(); } }
  await expect(async () => reader.metrics()).rejects.toThrow();
  await expect(async () => reader.metrics()).rejects.toThrow();
}, 30_000);

it.each(["after-result", "account-error"])("retains fresh post-await admission when account read changes deployment: %s", async stage => {
  const { reader, manifest } = await genuine(); await reader.metrics();
  let reached = false;
  const original = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    const statement = original.call(this, sql);
    if (!sql.startsWith("SELECT COUNT(DISTINCT LOWER(wallet_address))")) return statement;
    reached = true;
    if (stage === "account-error") { writeFileSync(manifest, "{}"); return statement; }
    return new Proxy(statement, { get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "get") return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args); writeFileSync(manifest, "{}"); return result;
      };
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  await expect(async () => reader.metrics()).rejects.toThrow(); expect(reached).toBe(true);
}, 30_000);

it.each([true, false])("preserves empty and missing-account metrics with accounts=%s", async accounts => {
  const db = nativeRows(accounts); expect(await fusedMetrics(db)).toEqual(await originalMetrics(db));
  expect((await fusedMetrics(db)).recordedAccounts).toBe(accounts ? 0 : null);
});

it("preserves mixed settlement, channel, feedback, gap and indexed-account projections", async () => {
  const db = nativeRows();
  for (const [query, origin, confidence, client] of [["q1", "web", "Low", null], ["q2", "mcp", "High", "codex"], ["q3", "engine", null, null]])
    insert(db, "query_runs", [query, origin, null, 100, "offline", 1, 0, confidence, client, 3, 1, 0]);
  for (const status of ["settled", "pending", "failed", "simulated", null])
    insert(db, "payment_events", [0.01, "synthetic-source", "q1", "citation", "web", status === "settled" ? 1 : 0, status, null, "synthetic-test-transaction"]);
  insert(db, "payment_events", [0.005, "keryx:operating-fee", "q2", "operating-fee", "mcp", 1, "settled", null, "synthetic-fee-original"]);
  insert(db, "answer_feedback", ["q1", "up"]); insert(db, "answer_feedback", ["q1", "down"]); insert(db, "answer_feedback", ["q2", "up"]);
  for (const status of ["filled", "pending", "running", "open", "fulfilled", null]) insert(db, "gap_intents", [status]);
  for (const wallet of [`0x${"aB".repeat(20)}`, `0x${"ab".repeat(20)}`, "malformed", null]) insert(db, "users", [wallet]);
  const before = db.prepare("SELECT total_changes() AS n").get()!.n;
  expect(await fusedMetrics(db)).toEqual(await originalMetrics(db));
  expect(db.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
});

it.each([null, 0, 1, "0.125", "not-a-number", new Uint8Array([1])])("keeps native amount conversion for %s", async amount => {
  const db = nativeRows(); insert(db, "payment_events", [amount, null, "q", "citation", "engine", 1, "settled", null, null]);
  expect(await fusedMetrics(db)).toEqual(await originalMetrics(db));
});

it("preserves null and mixed native row fields without JSON coercion or deduplication", async () => {
  const db = nativeRows();
  for (let i = 0; i < 2; i++) {
    insert(db, "query_runs", [null, null, null, "123", null, null, null, null, null, 3, 2, 1]);
    insert(db, "answer_feedback", [null, new Uint8Array([117, 112])]); insert(db, "gap_intents", [null]);
  }
  expect(await fusedMetrics(db)).toEqual(await originalMetrics(db));
});

it.each(["payment_events", "query_runs", "answer_feedback", "gap_intents"])("retains unsafe native integer refusal in %s", async table => {
  const db = nativeRows(), huge = BigInt("9007199254740993");
  const rows: Record<string, SQLInputValue[]> = { payment_events: [huge, "s", "q", "citation", "web", 1, "settled", null, null],
    query_runs: ["q", "web", null, huge, null, null, null, null, null, null, null, null], answer_feedback: [huge, "up"], gap_intents: [huge] };
  insert(db, table, rows[table]);
  const failure = async (operation: () => Promise<unknown>) => {
    try { await operation(); return null; }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      return { name: error.name, message: error.message, code: "code" in error ? error.code : undefined };
    }
  };
  const expected = await failure(() => originalMetrics(db)); expect(expected).not.toBeNull();
  expect(await failure(() => fusedMetrics(db))).toEqual(expected);
});

it("retains the optional account-query failure boundary", async () => {
  const db = nativeRows(); db.exec("DROP TABLE users; CREATE VIEW users AS SELECT 1 AS unavailable_column");
  expect(await fusedMetrics(db)).toEqual(await originalMetrics(db)); expect((await fusedMetrics(db)).recordedAccounts).toBeNull();
});
