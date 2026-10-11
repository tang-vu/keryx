import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRunOwnershipHistory, requireRunOwnershipHistory } from "../run-claims/history";
import { RUN_CLAIM_TTL_MS, type RunClaimBinding } from "../run-claims/contracts";
import type { QueryRun } from "../types";
import { writeSqliteQueryRun } from "./query-run-record";
import { createSqliteRunClaims, RUN_CLAIMS_SQL } from "./run-claims-sqlite";
import { createSqliteRunOwnershipHistory } from "./run-ownership-history-sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { SqliteAdapter } from "./sqlite-adapter";
import { syntheticStorageIdentity } from "./storage-identity-fixture";

const connections: DatabaseSync[] = [], adapters: SqliteAdapter[] = [];
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, hash = (value: string) => createHash("sha256").update(value).digest("hex");
const binding: RunClaimBinding = { network: "eip155:5042002", origin: "https://synthetic-claims.example" };
const date = "2026-10-11T00:00:00.000Z", stamp = Date.parse(date);
afterEach(() => { vi.unstubAllEnvs(); connections.splice(0).forEach(db => db.close()); adapters.splice(0).forEach(adapter => adapter.close()); });
function fixture() {
  const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db); db.exec(RUN_CLAIMS_SQL);
  let now = stamp + 1000;
  const claims = createSqliteRunClaims(db, { fixtureClock: () => now }), history = createSqliteRunOwnershipHistory(db);
  for (const wallet of [alice, bob]) db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(hash(wallet), wallet, stamp - 1000, stamp + RUN_CLAIM_TTL_MS * 2);
  const save = (id: string, patch: Partial<QueryRun> = {}) => {
    const run: QueryRun = { id, question: "Synthetic %_ question", createdAt: date, budget: 0.01, engine: "heuristic",
      answer: "Private fixture answer", subClaims: [], decisions: [], citations: [], trace: [], totalSpent: 0.01, totalToCreators: 0.005, paymentMode: "offline", ...patch };
    writeSqliteQueryRun(db, run, false); return run;
  };
  const claim = async (id: string, wallet = alice, targetBinding = binding) => {
    await claims.issue({ runId: id, completedAt: date, tokenHash: hash(id), binding: targetBinding });
    return claims.claim({ tokenHash: hash(id), wallet, sessionHash: hash(wallet), binding: targetBinding });
  };
  const list = (wallet = alice, targetBinding = binding) => history.list(wallet, { binding: targetBinding, filters: {}, take: 51 });
  return { db, claims, history, save, claim, list, setNow: (value: number) => { now = value; } };
}
describe("gated ordinary recorded and claimed ownership history", () => {
  it("joins recorded and claimed ownership once while excluding other/unclaimed/binding rows", async () => {
    const f = fixture(); f.save("recorded", { asker: alice, askerFunded: true }); f.save("claimed"); await f.claim("claimed");
    f.save("other", { asker: bob }); f.save("unclaimed"); f.save("other-claim"); await f.claim("other-claim", bob);
    f.save("other-origin"); await f.claim("other-origin", alice, { ...binding, origin: "https://other.example" });
    const rows = await f.list(); expect(rows.map(row => row.id)).toEqual(["recorded", "claimed"]);
    expect(rows[0].ownership).toEqual({ method: "recorded", claimedAt: null });
    expect(rows[1].ownership).toEqual({ method: "claimed", claimedAt: new Date(stamp + 1000).toISOString() });
    expect((await f.list(alice, { ...binding, network: "eip155:5042" })).map(row => row.id)).toEqual(["recorded"]);
    expect(JSON.stringify(rows)).not.toMatch(/Private fixture answer|token_hash|tokenHash|original_sha256|sessionHash|expiresAt/);
  });
  it("keeps the original byte-equal, including unknown receipt fields, and never assigns the claimant as payer", async () => {
    const f = fixture(), run = f.save("claimed", { fundingOwner: "treasury" });
    const original = { ...run, retainedReceipt: { payer: bob, transaction: "synthetic-never-settled", extra: true } };
    f.db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(JSON.stringify(original), run.id);
    f.db.exec("CREATE TABLE synthetic_payment_receipts(payer TEXT,settled INTEGER);INSERT INTO synthetic_payment_receipts VALUES('synthetic-nonclaimant',0)");
    await f.claim(run.id); const before = f.db.prepare("SELECT * FROM query_runs").all(), financial = f.db.prepare("SELECT * FROM synthetic_payment_receipts").all();
    const detail = await f.history.read(alice, binding, run.id); expect(detail?.run).toEqual(original);
    expect(detail?.run).not.toHaveProperty("asker"); expect(detail?.run.askerFunded).toBeUndefined();
    expect((await f.list())[0]).toMatchObject({ funding: "other-or-unknown", recordedSpendUsdc: 0.01, recordedCreatorAllocationUsdc: 0.005 });
    expect(f.db.prepare("SELECT * FROM query_runs").all()).toEqual(before); expect(f.db.prepare("SELECT * FROM synthetic_payment_receipts").all()).toEqual(financial);
    expect(await f.history.read(bob, binding, run.id)).toBeNull(); expect(await f.history.read(alice, binding, "missing")).toBeNull();
    f.setNow(stamp + RUN_CLAIM_TTL_MS * 3); expect((await f.list()).map(row => row.id)).toEqual([run.id]);
  });
  it("uses a descending binary keyset and first-page anchor across both ownership methods", async () => {
    const f = fixture(); for (const id of ["A", "a", "b", "c"]) { f.save(id, id === "b" ? { asker: alice } : {}); if (id !== "b") await f.claim(id); }
    const first = await readRunOwnershipHistory(f.history, alice, binding, { limit: 2 }); expect(first.rows.map(row => row.id)).toEqual(["c", "b"]);
    f.save("z", { asker: alice }); f.save("newer", { asker: alice, createdAt: "2026-10-12T00:00:00.000Z" });
    const second = await readRunOwnershipHistory(f.history, alice, binding, { limit: 2, cursor: first.nextCursor! });
    expect(second.rows.map(row => row.id)).toEqual(["a", "A"]); expect(second.nextCursor).toBeNull();
  });
  it("filters original metadata without inferring surface or claimant funding", async () => {
    const f = fixture(); f.save("claimed", { provenance: { version: 1, surface: "web", ownershipMethod: "unknown" } }); await f.claim("claimed");
    f.save("browser", { asker: alice, askerFunded: true, provenance: { version: 1, surface: "web", ownershipMethod: "session" } });
    f.save("legacy", { asker: alice, origin: "web" });
    expect((await readRunOwnershipHistory(f.history, alice, binding, { search: "%_", surface: "web", funding: "other-or-unknown", from: date, to: date })).rows.map(row => row.id)).toEqual(["claimed"]);
    expect((await readRunOwnershipHistory(f.history, alice, binding, { funding: "browser-recorded" })).rows.map(row => row.id)).toEqual(["browser"]);
    expect((await readRunOwnershipHistory(f.history, alice, binding, { surface: "unknown" })).rows.map(row => row.id)).toEqual(["legacy"]);
    expect((await readRunOwnershipHistory(f.history, alice, binding, { search: "synthetic" })).rows).toEqual([]);
  });
  it.each(["data", "indexed-owner", "order"])("changed claimed original %s loses read access rather than rewriting history", async mutation => {
    const f = fixture(); f.save("claimed"); await f.claim("claimed");
    if (mutation === "data") f.db.prepare("UPDATE query_runs SET data=json_set(data,'$.answer','Changed') WHERE id=?").run("claimed");
    if (mutation === "indexed-owner") f.db.prepare("UPDATE query_runs SET asker=? WHERE id=?").run(bob, "claimed");
    if (mutation === "order") f.db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at)
      VALUES('synthetic-order','claimed','synthetic-auth','synthetic-request',?,?,0,0,0,'deep','failed','synthetic-never-settled',?,?)`).run(bob, alice, date, date);
    expect(await f.list()).toEqual([]); expect(await f.history.read(alice, binding, "claimed")).toBeNull();
  });
  it("fails closed on corrupt recorded attribution and oversized details", async () => {
    const f = fixture(); f.save("bad", { asker: alice }); f.db.prepare("UPDATE query_runs SET data=json_set(data,'$.asker',?) WHERE id='bad'").run(bob);
    await expect(f.list()).rejects.toThrow(/^history_unavailable$/); await expect(f.history.read(alice, binding, "bad")).rejects.toThrow(/^history_unavailable$/);
    f.db.prepare("DELETE FROM query_runs WHERE id='bad'").run(); f.save("large", { asker: alice, answer: "x".repeat(4_000_000) });
    await expect(f.list()).rejects.toThrow(/^history_unavailable$/); await expect(f.history.read(alice, binding, "large")).rejects.toThrow(/^history_unavailable$/);
  });
  it("refuses lost schema and new enrollment without repairs or fallback", async () => {
    const f = fixture(); f.db.exec("DROP TRIGGER anonymous_run_claims_single_use");
    await expect(f.list()).rejects.toThrow(/^history_unavailable$/); await expect(f.history.read(alice, binding, "missing")).rejects.toThrow(/^history_unavailable$/);
    expect(() => createSqliteRunOwnershipHistory(f.db)).toThrow(/^claims_unavailable$/);
    const g = fixture(); g.db.exec("CREATE TABLE keryx_storage_identity(id INTEGER)"); await expect(g.list()).rejects.toThrow(/^history_unavailable$/);
    const unknown = new DatabaseSync(":memory:"); connections.push(unknown); installSqliteApplicationSchema(unknown);
    const before = unknown.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all(); expect(() => createSqliteRunOwnershipHistory(unknown)).toThrow(/^claims_unavailable$/);
    expect(unknown.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all()).toEqual(before);
  });
  it("attaches no default/native port or prototype method; admitted ordinary port is nonenumerable", async () => {
    const plain = new SqliteAdapter(":memory:"); adapters.push(plain); await plain.init(); expect(plain.runOwnershipHistory).toBeUndefined();
    vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); const missing = new SqliteAdapter(":memory:"); adapters.push(missing); await missing.init(); expect(missing.runOwnershipHistory).toBeUndefined();
    const admitted = new SqliteAdapter(":memory:"); adapters.push(admitted); await admitted.init();
    (Reflect.get(admitted, "db") as DatabaseSync).exec(RUN_CLAIMS_SQL); await admitted.init();
    expect(admitted.runOwnershipHistory).toBeDefined(); expect(Object.keys(admitted)).not.toContain("runOwnershipHistory");
    expect(Object.getOwnPropertyNames(SqliteAdapter.prototype)).not.toContain("runOwnershipHistory");
    const nativeFixture = fixture(), native = SqliteAdapter.assembleConnectionCore(nativeFixture.db, syntheticStorageIdentity("testnet-offline"), () => {});
    expect(() => requireRunOwnershipHistory(native)).toThrow(/^history_unavailable$/);
    expect(() => requireRunOwnershipHistory(new Proxy({}, { get() { throw new Error("sealed"); } }))).toThrow(/^history_unavailable$/);
  });
  it("binds cursor owner/origin/network/filters and rejects unknown query inputs before storage", async () => {
    const f = fixture(); f.save("a", { asker: alice }); f.save("b", { asker: alice });
    const first = await readRunOwnershipHistory(f.history, alice, binding, { limit: 1 }), list = vi.fn(f.history.list);
    for (const [wallet, target, query] of [[bob, binding, {}], [alice, { ...binding, origin: "https://other.example" }, {}],
      [alice, { ...binding, network: "eip155:5042" }, {}], [alice, binding, { search: "changed" }]] as const)
      await expect(readRunOwnershipHistory({ ...f.history, list }, wallet, target, { ...query, cursor: first.nextCursor! })).rejects.toThrow(/^invalid_history_query$/);
    await expect(f.history.list(alice, { binding, filters: {}, take: 52 })).rejects.toThrow(/^history_unavailable$/);
    await expect(f.history.list(alice, { binding, filters: {}, take: 1, wallet: bob } as Parameters<typeof f.history.list>[1])).rejects.toThrow(/^history_unavailable$/);
    expect(list).not.toHaveBeenCalled();
  });
});
