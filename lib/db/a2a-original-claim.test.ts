import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { syntheticA2aOriginal, seedSyntheticA2aOriginal } from "./a2a-original-fixture";
import type { A2aOriginalClaim } from "../a2a/original-claim";

const at = "2026-10-06T03:24:02.000Z";
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "keryx-exact-original-")), file = join(dir, "synthetic.sqlite");
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = new SqliteAdapter(file); cleanup.push(() => db.close()); await db.init();
  const native = new DatabaseSync(file); cleanup.push(() => native.close());
  return { db, native, file };
}

describe("native SQLite exact original claim", () => {
  it("targets the named original despite an older foreign job, and two connections have one winner", async () => {
    const { db, file } = await setup();
    const foreign = await seedSyntheticA2aOriginal(db, syntheticA2aOriginal(1));
    const expected = await seedSyntheticA2aOriginal(db, syntheticA2aOriginal(2));
    const other = new SqliteAdapter(file); cleanup.push(() => other.close()); await other.init();
    const results = await Promise.all([db.claimNextA2aOrder("worker-a", at, expected.binding), other.claimNextA2aOrder("worker-b", at, expected.binding)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)).toMatchObject({ id: expected.order.id, startedAt: at });
    expect(await db.getA2aOrder(foreign.order.id)).toEqual(foreign.order);
    expect(await db.claimNextA2aOrder("worker-c", at, expected.binding)).toBeNull();
  });

  it.each(["requestHash", "packageFingerprint"] as const)("does not mutate the original or another row when %s mismatches", async field => {
    const { db } = await setup(); const expected = await seedSyntheticA2aOriginal(db);
    const foreign = await seedSyntheticA2aOriginal(db, syntheticA2aOriginal(2));
    expect(await db.claimNextA2aOrder("worker", at, { ...expected.binding, [field]: "aa".repeat(32) })).toBeNull();
    expect(await db.getA2aOrder(expected.order.id)).toEqual(expected.order);
    expect(await db.getA2aOrder(foreign.order.id)).toEqual(foreign.order);
  });

  it.each([
    ["missing inbound", "DELETE FROM payment_events"],
    ["pending inbound", "UPDATE payment_events SET settled=0,settlement_status='pending'"],
    ["foreign inbound rail", "UPDATE payment_events SET network='eip155:5042'"],
    ["foreign inbound payer", "UPDATE payment_events SET payer='0x3333333333333333333333333333333333333333'"],
    ["foreign inbound payee", "UPDATE payment_events SET payee='0x3333333333333333333333333333333333333333'"],
    ["wrong inbound amount", "UPDATE payment_events SET amount_usdc=0.031"],
    ["wrong inbound nonce", "UPDATE payment_events SET authorization_id='0xwrong'"],
    ["wrong inbound transaction", "UPDATE payment_events SET tx_hash='synthetic-other-transaction'"],
    ["wrong inbound source", "UPDATE payment_events SET source_id='other'"],
    ["bad request body hash", "UPDATE a2a_orders SET request_data=json_set(request_data,'$.question','different')"],
    ["foreign request rail", "UPDATE a2a_orders SET request_data=json_set(request_data,'$.network','eip155:5042')"],
    ["Monthly original", "UPDATE a2a_orders SET request_data=json_set(request_data,'$.monthlyId','monthly_original')"],
    ["historical original", "UPDATE a2a_orders SET execution_journal_version=NULL"],
    ["crossed payment boundary", "UPDATE a2a_orders SET payment_started_at='2026-10-06T03:23:03.000Z'"],
    ["crossed save boundary", "UPDATE a2a_orders SET result_saving_at='2026-10-06T03:23:03.000Z'"],
    ["assigned worker", "UPDATE a2a_orders SET worker_id='original-worker'"],
    ["existing creator attempt", "INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,created_at) SELECT 'prior-attempt',query_id,'fetch','synthetic-source',payer,payee,0.001,created_at FROM payment_events"],
    ["wrong total", "UPDATE a2a_orders SET amount_usdc=0.031"],
    ["wrong creator cap", "UPDATE a2a_orders SET creator_budget_usdc=0.011"],
    ["wrong fee", "UPDATE a2a_orders SET service_fee_usdc=0.021"],
    ["unsupported package", "UPDATE a2a_orders SET package_data=json_set(package_data,'$.version','unsupported')"],
  ])("holds %s without a claim", async (_label, sql) => {
    const { db, native } = await setup(); const expected = await seedSyntheticA2aOriginal(db);
    native.exec(sql); const before = await db.getA2aOrder(expected.order.id);
    expect(await db.claimNextA2aOrder("worker", at, expected.binding)).toBeNull();
    expect(await db.getA2aOrder(expected.order.id)).toEqual(before);
  });

  it("reads genuine same-original proof in a readonly snapshot even after completion, without admitting execution", async () => {
    const { db, native, file } = await setup(); const expected = await seedSyntheticA2aOriginal(db);
    const reader = new SqliteAdapter(file, { readOnly: true }); cleanup.push(() => reader.close());
    expect(await reader.hasA2aOriginalSettlement(expected.binding)).toBe(true);
    native.exec("UPDATE a2a_orders SET status='completed',started_at='2026-10-06T03:24:02.000Z',worker_id='original-worker'");
    native.prepare("INSERT INTO query_runs(id) VALUES(?)").run(expected.order.id);
    expect(await reader.hasA2aOriginalSettlement(expected.binding)).toBe(true);
    expect(await db.claimNextA2aOrder("worker", at, expected.binding)).toBeNull();
    expect(await reader.hasA2aOriginalSettlement(syntheticA2aOriginal(2).binding)).toBe(false);
    expect(await reader.hasA2aOriginalSettlement({ ...expected.binding, requestHash: "aa".repeat(32) })).toBe(false);
    native.exec("UPDATE payment_events SET settled=0,settlement_status='failed'");
    expect(await reader.hasA2aOriginalSettlement(expected.binding)).toBe(false);
  });

  it.each([
    "DELETE FROM payment_events",
    "UPDATE payment_events SET settlement_status='pending'", "UPDATE payment_events SET tx_hash=NULL",
    "UPDATE payment_events SET payer='0x3333333333333333333333333333333333333333'",
    "UPDATE payment_events SET payee='0x3333333333333333333333333333333333333333'",
    "UPDATE payment_events SET amount_usdc=0.031", "UPDATE payment_events SET authorization_id='0xwrong'",
    "UPDATE payment_events SET network='eip155:5042'", "UPDATE payment_events SET query_id='foreign-query'",
  ])("does not establish original settlement from incomplete or foreign proof: %s", async sql => {
    const { db, native } = await setup(); const expected = await seedSyntheticA2aOriginal(db);
    native.exec(sql); expect(await db.hasA2aOriginalSettlement(expected.binding)).toBe(false);
    expect(await db.getA2aOrder(expected.order.id)).toEqual(expected.order);
  });

  it("holds a missing immutable purchase proof and a saved original", async () => {
    const { db, native } = await setup(); const expected = syntheticA2aOriginal();
    // Model missing historical admission evidence in this disposable ordinary fixture only.
    native.exec("DROP TRIGGER a2a_purchase_authorization");
    await db.createA2aOrder(expected.order); await db.recordPaymentOnce(expected.inbound);
    expect(await db.hasA2aOriginalSettlement(expected.binding)).toBe(false);
    expect(await db.claimNextA2aOrder("worker", at, expected.binding)).toBeNull();
    await db.claimResearchPurchase({ network: expected.binding.network, payer: expected.binding.payer, payee: expected.binding.payee,
      authorizationId: expected.binding.authorizationId, purpose: "a2a", requestHash: expected.binding.requestHash, amountMicros: 30000 });
    native.prepare("INSERT INTO query_runs(id) VALUES(?)").run(expected.order.id);
    expect(await db.claimNextA2aOrder("worker", at, expected.binding)).toBeNull();
    expect(await db.getA2aOrder(expected.order.id)).toEqual(expected.order);
  });

  it("holds a retained Monthly redemption even when request metadata is incomplete", async () => {
    const { db, native } = await setup(); const expected = await seedSyntheticA2aOriginal(db);
    const monthlyId = `monthly_${"ab".repeat(32)}`;
    native.prepare("INSERT INTO research_monthly(id,payer,data) VALUES(?,?,?)").run(monthlyId, expected.binding.payer, "{}");
    native.prepare("INSERT INTO research_monthly_redemptions(monthly_id,request_id,order_id,request_hash,created_at,slot) VALUES(?,?,?,?,?,0)")
      .run(monthlyId, "synthetic-slot", expected.order.id, expected.binding.requestHash, at);
    expect(await db.hasA2aOriginalSettlement(expected.binding)).toBe(false);
    expect(await db.claimNextA2aOrder("worker", at, expected.binding)).toBeNull();
    expect(await db.getA2aOrder(expected.order.id)).toEqual(expected.order);
  });

  it("refuses malformed bindings, a foreign profile and readonly authority before mutation", async () => {
    const { db, file } = await setup(); const expected = await seedSyntheticA2aOriginal(db);
    for (const binding of [{ ...expected.binding, queryId: syntheticA2aOriginal(2).binding.queryId },
      { ...expected.binding, amountMicroUsdc: "30001" }, { ...expected.binding, asset: "0x" + "33".repeat(20) },
      { ...expected.binding, gatewayContract: "0x" + "33".repeat(20) }])
      await expect(db.claimNextA2aOrder("worker", at, binding)).rejects.toThrow();
    await expect(db.claimNextA2aOrder("worker", at, syntheticA2aOriginal(3, ARC_MAINNET_PROFILE).binding)).rejects.toThrow(/profile/);
    await expect(db.claimNextA2aOrder("worker", at, null as unknown as A2aOriginalClaim)).rejects.toThrow();
    const reader = new SqliteAdapter(file, { readOnly: true }); cleanup.push(() => reader.close());
    await expect(reader.claimNextA2aOrder("worker", at, expected.binding)).rejects.toThrow();
    expect(await db.getA2aOrder(expected.order.id)).toEqual(expected.order);
  });
});
