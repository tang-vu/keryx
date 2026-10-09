import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createSqliteDeliverableAcceptance } from "../db/deliverable-acceptance-sqlite";
import { acceptanceInputSchema, requireDeliverableAcceptance } from "./contracts";
import { acceptanceFixture } from "./test-fixture";
import { originalBinding } from "./original";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
const open: Array<{ close(): void }> = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });
const fixture = async () => { const value = await acceptanceFixture(); open.push(value.db); return value; };
const readRows = (db: DatabaseSync) => JSON.stringify(db.prepare("SELECT * FROM a2a_orders").all()) + JSON.stringify(db.prepare("SELECT * FROM payment_events").all());

describe("original-customer acceptance journal", () => {
  it("starts no_response with immutable historical terms and no inferred response deadline", async () => {
    const { snapshot } = await fixture();
    expect(snapshot.state).toBe("no_response"); expect(snapshot.terms).toEqual({ remedy: "none", responseWindow: null, silence: "no_response" });
    expect(snapshot.revisionExecution).toBe("withheld"); expect(snapshot.refundExecution).toBe("withheld");
  });
  it.each(["accept", "revise", "reject"] as const)("records %s, exact readback, private reason and no original/payment write", async choice => {
    const { db, fixture: { order, binding }, port, authority, input } = await fixture();
    const raw = Reflect.get(db, "db") as DatabaseSync, before = readRows(raw);
    const result = await port.submit(order.payer, binding.network, order.id, { ...input, choice, reason: "Private synthetic reason 😀" }, authority);
    expect(result.state).toBe(choice === "accept" ? "accepted" : choice === "revise" ? "revision_requested" : "rejected");
    expect(result.revision).toBe(1); expect(result.review).toBe(choice === "accept" ? "not_requested" : "owner_review_required");
    expect(result.reason).toBe("Private synthetic reason 😀"); expect(readRows(raw)).toBe(before);
    expect(await port.publicState(binding.network, order.id)).toEqual({ format: "keryx-public-deliverable-state-v1", state: "not_shared", submittedAt: null });
  });
  it("lost acknowledgement and duplicate key return current state without adding an entry", async () => {
    const { db, fixture: { order, binding }, port, authority, input } = await fixture();
    await port.submit(order.payer, binding.network, order.id, input, authority);
    const result = await port.submit(order.payer, binding.network, order.id, input, authority);
    expect(result.revision).toBe(1);
    await port.submit(order.payer, binding.network, order.id, { ...input, expectedRevision: 1, idempotencyKey: "synthetic-request-0002", choice: "revise" }, authority);
    expect((await port.submit(order.payer, binding.network, order.id, input, authority)).revision).toBe(2);
    expect((Reflect.get(db, "db") as DatabaseSync).prepare("SELECT count(*) AS n FROM deliverable_acceptance_entries").get()?.n).toBe(2);
    await expect(port.submit(order.payer, binding.network, order.id, { ...input, choice: "reject" }, authority)).rejects.toThrow("acceptance_conflict");
    await expect(port.submit(order.payer, binding.network, order.id, { ...input, idempotencyKey: "synthetic-request-0003" }, authority)).rejects.toThrow("acceptance_conflict");
  });
  it("public consent exposes only choice and timestamp, and can be withdrawn by a new explicit revision", async () => {
    const { fixture: { order, binding }, port, authority, input } = await fixture();
    const saved = await port.submit(order.payer, binding.network, order.id, { ...input, reason: "Do not expose", publishState: true }, authority);
    const publicResult = await port.publicState(binding.network, order.id);
    expect(publicResult).toEqual({ format: "keryx-public-deliverable-state-v1", state: "accepted", submittedAt: saved.submittedAt });
    expect(JSON.stringify(publicResult)).not.toMatch(/Do not expose|wallet|digest|payer|payment|nonce/);
    await port.submit(order.payer, binding.network, order.id, { ...input, expectedRevision: 1, idempotencyKey: "synthetic-request-0002", publishState: false }, authority);
    expect((await port.publicState(binding.network, order.id)).state).toBe("not_shared");
  });
  it("does not invent timeout or execute revision for an old delivered original", async () => {
    const { fixture: { order, binding }, port, authority, input } = await fixture();
    const saved = await port.submit(order.payer, binding.network, order.id, { ...input, choice: "revise" }, authority);
    expect(saved.terms.responseWindow).toBeNull(); expect(saved.review).toBe("owner_review_required"); expect(saved.revisionExecution).toBe("withheld");
  });
  it("records a rejection with a pending creator leg without altering it or settled rewards", async () => {
    const { db, fixture: { order, binding }, port, authority, input } = await fixture();
    await db.recordPaymentOnce({ id: "synthetic-pending", kind: "citation", queryId: order.id, sourceId: "synthetic-source", sourceName: "Synthetic",
      payer: order.payee, payee: `0x${"33".repeat(20)}`, amountUsdc: 0.001, txHash: "", settled: false, settlementStatus: "pending",
      authorizationId: `0x${"44".repeat(32)}`, network: binding.network, createdAt: "2026-10-09T00:00:00.000Z" });
    const raw = Reflect.get(db, "db") as DatabaseSync, before = readRows(raw);
    const result = await port.submit(order.payer, binding.network, order.id, { ...input, choice: "reject" }, authority);
    expect(result.pendingPaymentLegs).toBe(true); expect(result.refundExecution).toBe("withheld"); expect(readRows(raw)).toBe(before);
  });
  it("refuses changed delivered bytes and hides stale public consent", async () => {
    const { db, fixture: { order, binding }, port, authority, input } = await fixture();
    await port.submit(order.payer, binding.network, order.id, { ...input, publishState: true }, authority);
    const raw = Reflect.get(db, "db") as DatabaseSync;
    raw.prepare("UPDATE a2a_orders SET response_data=? WHERE id=?").run(JSON.stringify({ status: "completed", queryId: order.id, answer: "Changed synthetic delivery" }), order.id);
    await expect(port.submit(order.payer, binding.network, order.id, input, authority)).rejects.toThrow("acceptance_conflict");
    expect((await port.publicState(binding.network, order.id)).state).toBe("not_shared");
  });
  it("refuses another owner, original network, missing settlement and unsupported originals", async () => {
    const { db, fixture: { order, binding }, port, authority, input } = await fixture();
    await expect(port.read(`0x${"33".repeat(20)}`, binding.network, order.id)).rejects.toThrow("acceptance_unavailable");
    await expect(port.submit(order.payer, "eip155:5042", order.id, input, authority)).rejects.toThrow("acceptance_unavailable");
    const raw = Reflect.get(db, "db") as DatabaseSync;
    raw.prepare("UPDATE payment_events SET settled=0,settlement_status='pending',tx_hash='' WHERE kind='inbound'").run();
    await expect(port.read(order.payer, binding.network, order.id)).rejects.toThrow("acceptance_unavailable");
    expect(() => requireDeliverableAcceptance({})).toThrow("acceptance_unavailable");
  });
  it("rechecks revoked key and expired/revoked session before any journal append", async () => {
    const { db, fixture: { order, binding }, port, authority, input } = await fixture();
    await db.revokeApiKey(authority.id, order.payer);
    await expect(port.submit(order.payer, binding.network, order.id, input, authority)).rejects.toThrow("acceptance_unauthenticated");
    const id = "aa".repeat(32), now = Date.now(); await db.createWebSession({ hash: id, wallet: order.payer, issuedAt: now - 1000, expiresAt: now + 10000 });
    const saved = await port.submit(order.payer, binding.network, order.id, input, { kind: "session", id }); expect(saved.revision).toBe(1);
    await db.revokeWebSession(id, order.payer);
    await expect(port.submit(order.payer, binding.network, order.id, { ...input, expectedRevision: 1, idempotencyKey: "synthetic-request-0002" }, { kind: "session", id })).rejects.toThrow("acceptance_unauthenticated");
  });
  it("refuses enrollment and unknown domain schemas before mutation", async () => {
    const { db, fixture: { order, binding }, port } = await fixture(), raw = Reflect.get(db, "db") as DatabaseSync;
    raw.exec("CREATE TABLE keryx_storage_identity(id TEXT)");
    await expect(port.read(order.payer, binding.network, order.id)).rejects.toThrow("unavailable in enrolled storage");
    const other = new DatabaseSync(":memory:"); open.push(other); other.exec("CREATE TABLE deliverable_acceptance_entries(unknown TEXT)");
    expect(() => createSqliteDeliverableAcceptance(other)).toThrow("acceptance_unavailable");
    expect(other.prepare("PRAGMA table_info(deliverable_acceptance_entries)").all()).toHaveLength(1);
    expect(Object.keys(db)).not.toContain("deliverableAcceptance");
  });
  it("actual enrolled connection-core composition has no acceptance port and no journal writes", () => {
    const raw = new DatabaseSync(":memory:"); open.push(raw);
    const before = JSON.stringify(raw.prepare("SELECT * FROM sqlite_schema").all());
    const core = SqliteAdapter.assembleConnectionCore(raw, syntheticStorageIdentity("testnet-offline"), () => {});
    expect(core.deliverableAcceptance).toBeUndefined(); expect(() => requireDeliverableAcceptance(core)).toThrow("acceptance_unavailable");
    expect(JSON.stringify(raw.prepare("SELECT * FROM sqlite_schema").all())).toBe(before);
  });
  it.each(["\ud800", "\udc00", "unsafe\u0000text"])("rejects malformed/private control input %j before append", async reason => {
    const { input } = await fixture(); expect(() => acceptanceInputSchema.parse({ ...input, reason })).toThrow();
  });
  it("refuses an unsafe micro amount rather than round/truncate it", async () => {
    const { db, fixture: { order, binding } } = await fixture(), raw = Reflect.get(db, "db") as DatabaseSync;
    const row = raw.prepare("SELECT * FROM a2a_orders WHERE id=?").get(order.id)!;
    expect(() => originalBinding("00000000-0000-4000-8000-000000000001", JSON.stringify({ order: { ...row, amount_usdc: 0.03000001 }, deliveryText: row.response_data, settled: true, network: binding.network }), order.payer, binding.network, order.id)).toThrow("acceptance_unavailable");
  });
});
