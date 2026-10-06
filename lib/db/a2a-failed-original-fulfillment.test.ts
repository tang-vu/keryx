import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter } from "./supabase-adapter";
import { SUPABASE_ENROLLED_METHODS } from "./supabase-enrolled-methods";
import { seedSyntheticA2aOriginal } from "./a2a-original-fixture";
import { syntheticFailedOriginal, syntheticFulfilledRun } from "./a2a-fulfillment-fixture";
import { fulfillmentObjectSha256 } from "../a2a/failed-original-fulfillment-protocol";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.useRealTimers(); });
async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-06T10:00:05.000Z");
  const dir = mkdtempSync(join(tmpdir(), "keryx-fulfill-original-")), file = join(dir, "synthetic.sqlite");
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = new SqliteAdapter(file); cleanup.push(() => db.close()); await db.init();
  const native = new DatabaseSync(file); cleanup.push(() => native.close());
  const fixture = syntheticFailedOriginal(); await seedSyntheticA2aOriginal(db, fixture);
  return { db, native, file, fixture };
}
const getClaim = async (f: Awaited<ReturnType<typeof setup>>) => {
  const claim = await f.db.claimA2aFailedOriginalFulfillment(f.fixture.input); expect(claim).not.toBeNull(); return claim!;
};

describe("same failed original native fulfillment", () => {
  it("admits one permanent claimant, preserves the original and rejects a second connection or takeover", async () => {
    const f = await setup(), foreign = await seedSyntheticA2aOriginal(f.db, syntheticFailedOriginal(2));
    const other = new SqliteAdapter(f.file); cleanup.push(() => other.close()); await other.init();
    const claims = await Promise.all([f.db.claimA2aFailedOriginalFulfillment(f.fixture.input),
      other.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, claimId: "bb".repeat(32) })]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await f.db.getA2aOrder(f.fixture.order.id)).toEqual(f.fixture.order);
    expect(await f.db.getA2aOrder(foreign.order.id)).toEqual(foreign.order);
    expect(await other.claimA2aFailedOriginalFulfillment(f.fixture.input)).toBeNull();
    const stored = await f.db.getA2aFailedOriginalFulfillment(f.fixture.order.id);
    expect(stored?.claim.failedOrder).toEqual(f.fixture.order); expect(stored?.completion).toBeNull();
    expect(() => f.native.exec("DELETE FROM a2a_failed_original_fulfillments")).toThrow(/retained/);
    expect(() => f.native.exec("UPDATE a2a_failed_original_fulfillments SET claimed_at='later'")).toThrow(/retained/);
  });

  it.each([
    "DELETE FROM payment_events", "UPDATE payment_events SET settled=0,settlement_status='pending'",
    "UPDATE payment_events SET tx_hash='synthetic-foreign'", "UPDATE payment_events SET amount_usdc=0.031",
    "UPDATE a2a_orders SET status='running'", "UPDATE a2a_orders SET error_code='payment_failed'",
    "UPDATE a2a_orders SET started_at=NULL", "UPDATE a2a_orders SET execution_journal_version=NULL",
    "UPDATE a2a_orders SET created_at='malformed'", "UPDATE a2a_orders SET updated_at='2026-10-06T03:24:01.000Z'",
    "UPDATE a2a_orders SET worker_id=NULL", "UPDATE a2a_orders SET request_data=json_set(request_data,'$.origin','engine')",
    "UPDATE a2a_orders SET payment_started_at='2026-10-06T03:24:02.000Z'",
    "UPDATE a2a_orders SET result_saving_at='2026-10-06T03:24:02.000Z'",
    "INSERT INTO query_runs(id) SELECT id FROM a2a_orders",
    "INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,created_at) SELECT 'creator',query_id,'cite','synthetic',payer,payee,0.001,created_at FROM payment_events",
  ])("refuses changed, incomplete or exposed evidence with no claim: %s", async sql => {
    const f = await setup(); f.native.exec(sql); const before = await f.db.getA2aOrder(f.fixture.order.id);
    expect(await f.db.claimA2aFailedOriginalFulfillment(f.fixture.input)).toBeNull();
    expect(await f.db.getA2aOrder(f.fixture.order.id)).toEqual(before);
    expect(f.native.prepare("SELECT count(*) AS n FROM a2a_failed_original_fulfillments").get()?.n).toBe(0);
  });

  it("requires immutable purchase proof and unexpired, recent claim admission; readonly cannot claim", async () => {
    const f = await setup();
    const readonly = new SqliteAdapter(f.file, { readOnly: true }); cleanup.push(() => readonly.close());
    expect(await readonly.getA2aFailedOriginalFulfillment(f.fixture.order.id)).toBeNull();
    await expect(readonly.claimA2aFailedOriginalFulfillment(f.fixture.input)).rejects.toThrow();
    await expect(f.db.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, claimedAt: "2026-10-06T09:00:00.000Z" })).rejects.toThrow(/window/);
    vi.setSystemTime("2026-10-07T00:00:00.000Z");
    await expect(f.db.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, claimedAt: new Date().toISOString() })).rejects.toThrow(/window/);
    expect(await f.db.getA2aOrder(f.fixture.order.id)).toEqual(f.fixture.order);
  });

  it("inserts the same real result once, keeps original accepted/started times and exposes readonly exact proof", async () => {
    const f = await setup(), claim = await getClaim(f), result = syntheticFulfilledRun(claim);
    expect(await f.db.hasA2aFailedOriginalFulfillment(claim.authority)).toBe(false);
    expect(await f.db.completeA2aFailedOriginalFulfillment(result)).toBe(true);
    const order = await f.db.getA2aOrder(f.fixture.order.id);
    expect(order).toMatchObject({ status: "completed", errorCode: null, startedAt: f.fixture.order.startedAt,
      createdAt: f.fixture.order.createdAt, workerId: f.fixture.order.workerId, paymentStartedAt: null,
      resolution: { action: "fulfill_failed_original", reason: "verified_failed_original_fulfilled" } });
    expect(await f.db.getQueryRun(f.fixture.order.id)).toEqual(result.run);
    const readonly = new SqliteAdapter(f.file, { readOnly: true }); cleanup.push(() => readonly.close());
    expect(await readonly.hasA2aFailedOriginalFulfillment(claim.authority)).toBe(true);
    expect(await readonly.getA2aFailedOriginalFulfillment(f.fixture.order.id)).toEqual({ claim, completion: {
      claimId: result.claimId, originalId: result.originalId, runSha256: result.runSha256,
      providerLedgerSha256: result.providerLedgerSha256, completedAt: result.completedAt } });
    await expect(readonly.completeA2aFailedOriginalFulfillment(result)).rejects.toThrow();
    expect(await f.db.completeA2aFailedOriginalFulfillment(result)).toBe(true);
    expect(await f.db.claimA2aFailedOriginalFulfillment(f.fixture.input)).toBeNull();
    expect(() => f.native.exec("DELETE FROM a2a_fulfillment_completions")).toThrow(/retained/);
    expect(f.native.prepare("SELECT count(*) AS n FROM payment_events").get()?.n).toBe(1);
    f.native.exec("UPDATE a2a_orders SET response_data='{}'");
    expect(await readonly.hasA2aFailedOriginalFulfillment(claim.authority)).toBe(false);
  });

  it("native delivered proof refuses an altered original acceptance timestamp even if a receipt is retained", async () => {
    const f = await setup(), claim = await getClaim(f), result = syntheticFulfilledRun(claim);
    expect(await f.db.completeA2aFailedOriginalFulfillment(result)).toBe(true);
    f.native.exec("UPDATE a2a_orders SET created_at='2026-10-06T03:23:03.000Z'");
    expect(await f.db.hasA2aFailedOriginalFulfillment(claim.authority)).toBe(false);
  });

  it("accepts the real renderer's escaped technical literals while keeping a rejected second-source gap", async () => {
    const f = await setup(); f.fixture.input.authority.input.selectedDocumentIds.push("document-two");
    const claim = await getClaim(f), result = syntheticFulfilledRun(claim), run = result.run;
    run.originalFulfillment!.statements[0].text = "Use `is_valid` with [S2] as literal source data.";
    run.evidence!.push({ claimIndex: 1, claim: run.subClaims[1], marker: "S2", sourceId: "public:fulfillment:document-two",
      sourceName: "Synthetic rejected source", sourceKind: "public-reference", quote: "A rejected insufficient quote.",
      support: 0.2, qualifiesForAnswer: false, qualifiesForReward: false });
    run.answer = finalizeGroundedAnswer({ question: run.question, answer: "", statements: run.originalFulfillment!.statements,
      ledger: { evidence: run.evidence!, claimCoverage: run.claimCoverage!, acceptedMarkers: new Set(["S1"]),
        droppedEvidence: 0, droppedCitations: [] } });
    result.runSha256 = fulfillmentObjectSha256(run);
    expect(await f.db.completeA2aFailedOriginalFulfillment(result)).toBe(true);
    expect(await f.db.hasA2aFailedOriginalFulfillment(claim.authority)).toBe(true);
    expect(run.answer).toContain("Evidence gap");
  });

  it("rolls back result insertion and original CAS together when final completion fails", async () => {
    const f = await setup(), claim = await getClaim(f), result = syntheticFulfilledRun(claim);
    f.native.exec("CREATE TRIGGER synthetic_abort BEFORE INSERT ON a2a_fulfillment_completions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    await expect(f.db.completeA2aFailedOriginalFulfillment(result)).rejects.toThrow(/synthetic failure/);
    expect(await f.db.getQueryRun(result.run.id)).toBeNull();
    expect(await f.db.getA2aOrder(result.run.id)).toEqual(f.fixture.order);
    expect((await f.db.getA2aFailedOriginalFulfillment(result.run.id))?.completion).toBeNull();
  });

  it.each(["creator", "settlement", "saved", "original"])("holds a racing %s change without replacing or erasing history", async kind => {
    const f = await setup(), claim = await getClaim(f), result = syntheticFulfilledRun(claim);
    if (kind === "creator") f.native.exec("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,created_at) SELECT 'creator',query_id,'fetch','synthetic',payer,payee,0.001,created_at FROM payment_events");
    if (kind === "settlement") f.native.exec("UPDATE payment_events SET settled=0,settlement_status='pending'");
    if (kind === "saved") f.native.prepare("INSERT INTO query_runs(id,data) VALUES(?,?)").run(result.run.id, '{"synthetic":"retained"}');
    if (kind === "original") f.native.exec("UPDATE a2a_orders SET updated_at='2026-10-06T03:24:04.000Z'");
    const before = await f.db.getA2aOrder(result.run.id);
    expect(await f.db.completeA2aFailedOriginalFulfillment(result)).toBe(false);
    expect(await f.db.getA2aOrder(result.run.id)).toEqual(before);
    expect((await f.db.getA2aFailedOriginalFulfillment(result.run.id))?.completion).toBeNull();
  });

  it.each(["question", "target", "cost", "reward", "statement", "hash", "engine", "duration", "coverage", "draft", "gap", "gap-render"])("rejects a fabricated %s result before mutation", async kind => {
    const f = await setup(), claim = await getClaim(f), result = syntheticFulfilledRun(claim);
    if (kind === "question") result.run.question = "different";
    if (kind === "target") result.run.subClaims.pop();
    if (kind === "cost") result.run.totalSpent = 0.001;
    if (kind === "reward") result.run.citations[0].reward = 0.001;
    if (kind === "statement") result.run.originalFulfillment!.statements[0].quote = "unsupported";
    if (kind === "engine") result.run.engine = "heuristic";
    if (kind === "duration") result.run.durationMs = 0;
    if (kind === "coverage") result.run.claimCoverage![1].coverage = 1;
    if (kind === "draft") result.run.answer += "\nUnreviewed raw draft assertion.";
    if (kind === "gap") result.run.originalFulfillment!.evidenceGaps = [{ claimIndex: 7, missingRequestedParts: ["Out-of-scope gap"] }];
    if (kind === "gap-render") result.run.originalFulfillment!.evidenceGaps = [{ claimIndex: 0, missingRequestedParts: ["A missing requested detail"] }];
    if (kind !== "hash") result.runSha256 = fulfillmentObjectSha256(result.run);
    else result.runSha256 = "bb".repeat(32);
    await expect(f.db.completeA2aFailedOriginalFulfillment(result)).rejects.toThrow(/refused/);
    expect(await f.db.getQueryRun(result.run.id)).toBeNull();
    expect(await f.db.getA2aOrder(result.run.id)).toEqual(f.fixture.order);
  });

  it("explicitly refuses every PostgreSQL fulfillment capability before any transport", async () => {
    const fixture = syntheticFailedOriginal(), claim = { ...fixture.input, failedOrder: fixture.order };
    const postgres = Object.create(SupabaseAdapter.prototype) as SupabaseAdapter;
    await expect(postgres.claimA2aFailedOriginalFulfillment(fixture.input)).rejects.toThrow(/not admitted/);
    await expect(postgres.getA2aFailedOriginalFulfillment(fixture.order.id)).rejects.toThrow(/not admitted/);
    await expect(postgres.completeA2aFailedOriginalFulfillment(syntheticFulfilledRun(claim))).rejects.toThrow(/not admitted/);
    await expect(postgres.hasA2aFailedOriginalFulfillment(fixture.authority)).rejects.toThrow(/not admitted/);
    for (const method of ["claimA2aFailedOriginalFulfillment", "getA2aFailedOriginalFulfillment", "completeA2aFailedOriginalFulfillment", "hasA2aFailedOriginalFulfillment"] as const)
      expect(SUPABASE_ENROLLED_METHODS[method]).toBe("unsupported");
  });
});
