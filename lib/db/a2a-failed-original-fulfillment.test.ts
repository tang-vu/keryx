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
import { fulfillmentObjectSha256, fulfillmentAuthoritySchema } from "../a2a/failed-original-fulfillment-protocol";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import type { FulfillmentEvidenceCapability } from "../a2a/fulfillment-supplement-evidence";
import { canonicalJson } from "../canonical-json";
import { buildCitationExport } from "../research-citation-export";
import { evidenceMatrixCsv } from "../research/evidence-matrix";
import { bibliographicOriginalDeliverable } from "../research/bibliographic-original-text";
import type { BibliographicOriginalRecord } from "../research/bibliographic-original-types";

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

// Historical presentation built from the unchanged pre-CSL export primitives,
// not the compatibility helper or removal of fields from an actual response.
async function completedPresentationFixture(withBibliography = false) {
  const f = await setup(), claim = await getClaim(f), result = syntheticFulfilledRun(claim);
  const identity = { itemId: "document-one", itemTitle: "Synthetic retained article",
    itemUrl: "https://example.invalid/document-one", contentVersion: "v1" };
  Object.assign(result.run.citations[0], identity); Object.assign(result.run.evidence![0], identity);
  if (withBibliography) {
    const missing = { state: "missing", reason: "read-unavailable" } as const;
    const record: BibliographicOriginalRecord = { scope: "metadata-only",
      requested: { scope: "metadata-only", language: "en", target: { kind: "arxiv", id: "2005.11401v4" } },
      fields: { title: missing, firstAuthor: missing, identifier: missing, year: missing,
        journal: missing, doi: missing, status: missing }, authors: [], authorCount: 0,
      authorsIncomplete: true, peerReview: "unknown", failure: "read-unavailable" };
    result.run.bibliography = { kind: "bibliography", ...bibliographicOriginalDeliverable(record), record,
      originalQuestionSha256: "ba".repeat(32), requestedFields: ["title", "firstAuthor", "identifier"], requestedAuthorCount: 1 };
  }
  result.runSha256 = fulfillmentObjectSha256(result.run);
  expect(await f.db.completeA2aFailedOriginalFulfillment(result)).toBe(true);
  const modern = (await f.db.getA2aOrder(result.originalId))!.response!;
  const legacy = { ...modern, researchExports: {
    bibtex: buildCitationExport(result.run.citations, "bibtex"), ris: buildCitationExport(result.run.citations, "ris"),
    evidenceCsv: evidenceMatrixCsv(result.run) },
    ...(result.run.bibliography ? { bibliographyExports: result.run.bibliography.bibliographyExports } : {}) };
  return { ...f, claim, result, modern, legacy };
}
function retainedRows(native: DatabaseSync) {
  return canonicalJson(["a2a_orders", "query_runs", "a2a_failed_original_fulfillments",
    "a2a_fulfillment_completions", "payment_events"].map(table => native.prepare(`SELECT * FROM ${table}`).all()));
}
function storeResponse(f: Awaited<ReturnType<typeof completedPresentationFixture>>, response: unknown) {
  f.native.prepare("UPDATE a2a_orders SET response_data=? WHERE id=?").run(JSON.stringify(response), f.result.originalId);
}

describe("same failed original native fulfillment", () => {
  it("keeps a v1 native claim readable after its historical fixed expiry", async () => {
    const f = await setup(), claim = await getClaim(f);
    vi.setSystemTime("2026-10-07T04:00:00.000Z");
    expect((await f.db.getA2aFailedOriginalFulfillment(f.fixture.order.id))?.claim).toEqual(claim);
    expect(claim.authority.format).toBe("keryx-a2a-failed-original-fulfillment-authority-v1");
  });
  it("refuses native v2 admission before approval and never renews a permanent original claim", async () => {
    const f = await setup(), supplierWindow = { approvalReceivedAt: "2026-10-07T01:30:00.000Z",
      expiresAt: "2026-10-07T03:00:00.000Z", maximumDurationMs: 5_400_000 as const };
    const authority = fulfillmentAuthoritySchema.parse({ ...f.fixture.authority,
      format: "keryx-a2a-failed-original-fulfillment-authority-v2", expiresAt: supplierWindow.expiresAt, supplierWindow });
    vi.setSystemTime("2026-10-07T01:29:59.999Z");
    await expect(f.db.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, authority,
      claimedAt: new Date().toISOString() })).rejects.toThrow(/window/);
    // A caller cannot use a future recorded time to cross the actual-time guard.
    await expect(f.db.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, authority,
      claimedAt: supplierWindow.approvalReceivedAt })).rejects.toThrow(/window/);
    expect(await f.db.getA2aFailedOriginalFulfillment(f.fixture.order.id)).toBeNull();
    vi.setSystemTime("2026-10-07T01:30:05.000Z");
    const claim = await f.db.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, authority, claimedAt: new Date().toISOString() });
    expect(claim).not.toBeNull();
    vi.setSystemTime("2026-10-07T01:32:00.000Z");
    const renewed = fulfillmentAuthoritySchema.parse({ ...authority, expiresAt: "2026-10-07T03:01:00.000Z",
      supplierWindow: { ...supplierWindow, approvalReceivedAt: "2026-10-07T01:31:00.000Z", expiresAt: "2026-10-07T03:01:00.000Z" } });
    expect(await f.db.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, authority: renewed,
      claimId: "bc".repeat(32), claimedAt: new Date().toISOString() })).toBeNull();
    expect((await f.db.getA2aFailedOriginalFulfillment(f.fixture.order.id))?.claim).toEqual(claim);
  });
  it("allows exact v2 metadata completion after expiry but altered window authority cannot prove delivery", async () => {
    const f = await setup(), supplierWindow = { approvalReceivedAt: "2026-10-07T01:30:00.000Z",
      expiresAt: "2026-10-07T03:00:00.000Z", maximumDurationMs: 5_400_000 as const };
    const authority = fulfillmentAuthoritySchema.parse({ ...f.fixture.authority,
      format: "keryx-a2a-failed-original-fulfillment-authority-v2", expiresAt: supplierWindow.expiresAt, supplierWindow });
    vi.setSystemTime("2026-10-07T01:30:05.000Z");
    const claim = await f.db.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, authority, claimedAt: new Date().toISOString() });
    expect(claim).not.toBeNull(); const result = syntheticFulfilledRun(claim!);
    result.run.createdAt = "2026-10-07T01:31:00.000Z"; result.runSha256 = fulfillmentObjectSha256(result.run);
    result.completedAt = "2026-10-07T03:00:10.000Z";
    vi.setSystemTime(result.completedAt);
    expect(await f.db.completeA2aFailedOriginalFulfillment(result)).toBe(true);
    expect(await f.db.hasA2aFailedOriginalFulfillment(authority)).toBe(true);
    expect(await f.db.hasA2aFailedOriginalFulfillment(fulfillmentAuthoritySchema.parse({ ...authority,
      supplierWindow: { ...supplierWindow, approvalReceivedAt: "2026-10-07T01:30:00.001Z" } }))).toBe(false);
    expect((await f.db.getA2aFailedOriginalFulfillment(f.fixture.order.id))?.claim.authority).toEqual(authority);
  });
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

  it.each([false, true])("reads exact modern and pre-CSL native responses without changing rows (bibliography=%s)", async bibliography => {
    const f = await completedPresentationFixture(bibliography);
    const exports = f.modern.researchExports as Record<string, unknown>;
    expect(exports).toHaveProperty("cslJson");
    expect(f.legacy.researchExports.bibtex.content).toContain("Synthetic retained article");
    expect(f.legacy.researchExports.ris.content).toContain("Content version: v1");
    expect(f.legacy.researchExports.evidenceCsv).toContain('"v1","Synthetic exact source quote."');
    const readonly = new SqliteAdapter(f.file, { readOnly: true }); cleanup.push(() => readonly.close());
    const modernRows = retainedRows(f.native);
    expect(await readonly.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(true);
    expect(retainedRows(f.native)).toBe(modernRows);
    storeResponse(f, f.legacy); const legacyRows = retainedRows(f.native);
    expect(await readonly.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(true);
    expect(retainedRows(f.native)).toBe(legacyRows);
    expect((await readonly.getA2aOrder(f.result.originalId))!.response).toEqual(f.legacy);
    expect(await f.db.completeA2aFailedOriginalFulfillment(f.result)).toBe(true);
    expect(retainedRows(f.native)).toBe(legacyRows); // idempotent completion does not upgrade a saved receipt
  });

  it.each(["money", "pricing", "answer", "evidence", "version", "unknown", "export-unknown", "bibtex", "ris", "csv", "missing-export"])(
    "refuses corrupted %s in the complete pre-CSL response without changing native rows", async kind => {
      const f = await completedPresentationFixture();
      const response = JSON.parse(JSON.stringify(f.legacy));
      if (kind === "money") response.totalPricePaid += 0.000001;
      if (kind === "pricing") response.pricing.unknownAuthority = "forged";
      if (kind === "answer") response.answer += " An unreviewed assertion.";
      if (kind === "evidence") response.evidence[0].quote = "Altered quote";
      if (kind === "version") response.citations[0].contentVersion = "v2";
      if (kind === "unknown") response.futureReceiptField = "forged";
      if (kind === "export-unknown") response.researchExports.futureFormat = "forged";
      if (kind === "bibtex") response.researchExports.bibtex.content += "FORGED";
      if (kind === "ris") response.researchExports.ris.count += 1;
      if (kind === "csv") response.researchExports.evidenceCsv += "FORGED";
      if (kind === "missing-export") delete response.researchExports.ris;
      storeResponse(f, response); const before = retainedRows(f.native);
      expect(await f.db.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(false);
      expect(retainedRows(f.native)).toBe(before);
    });

  it.each(["null", "malformed", "content", "count", "extra"])("refuses %s present CSL instead of treating it as legacy", async kind => {
    const f = await completedPresentationFixture(), response = JSON.parse(JSON.stringify(f.modern));
    if (kind === "null") response.researchExports.cslJson = null;
    if (kind === "malformed") response.researchExports.cslJson = {};
    if (kind === "content") response.researchExports.cslJson.content = "[]";
    if (kind === "count") response.researchExports.cslJson.count = 9;
    if (kind === "extra") response.researchExports.cslJson.unknown = true;
    storeResponse(f, response);
    expect(await f.db.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(false);
  });

  it.each(["research-only", "bibliography-only", "bibliography-null", "bibliography-corrupt", "nested-bibliography"])(
    "refuses partial or changed bibliography presentation: %s", async kind => {
      const f = await completedPresentationFixture(true), response = JSON.parse(JSON.stringify(f.modern));
      if (kind === "research-only") response.researchExports = f.legacy.researchExports;
      if (kind === "bibliography-only") response.bibliographyExports = f.legacy.bibliographyExports;
      if (kind === "bibliography-null") response.bibliographyExports.cslJson = null;
      if (kind === "bibliography-corrupt") response.bibliographyExports.cslJson.count = 1;
      if (kind === "nested-bibliography") response.bibliography.text += "FORGED";
      storeResponse(f, response);
      expect(await f.db.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(false);
    });

  it("keeps retained run hashes and original financial/claim evidence mandatory for legacy presentation", async () => {
    const f = await completedPresentationFixture(); storeResponse(f, f.legacy);
    const before = retainedRows(f.native);
    const savedRun = String(f.native.prepare("SELECT data FROM query_runs WHERE id=?").get(f.result.run.id)!.data);
    const run = JSON.parse(savedRun);
    run.answer += "FORGED";
    f.native.prepare("UPDATE query_runs SET data=? WHERE id=?").run(JSON.stringify(run), f.result.run.id);
    expect(await f.db.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(false);
    f.native.prepare("UPDATE query_runs SET data=? WHERE id=?").run(savedRun, f.result.run.id);
    expect(retainedRows(f.native)).toBe(before);
    expect(await f.db.hasA2aFailedOriginalFulfillment({ ...f.claim.authority, executorCommit: "b".repeat(40) })).toBe(false);
    f.native.exec("UPDATE payment_events SET amount_usdc=0.031");
    expect(await f.db.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(false);
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
    const counterfeit = Object.freeze({}) as FulfillmentEvidenceCapability;
    await expect(postgres.completeA2aFailedOriginalFulfillment(syntheticFulfilledRun(claim), counterfeit)).rejects.toThrow(/not admitted/);
    await expect(postgres.hasA2aFailedOriginalFulfillment(fixture.authority, counterfeit)).rejects.toThrow(/not admitted/);
    for (const method of ["claimA2aFailedOriginalFulfillment", "getA2aFailedOriginalFulfillment", "completeA2aFailedOriginalFulfillment", "hasA2aFailedOriginalFulfillment"] as const)
      expect(SUPABASE_ENROLLED_METHODS[method]).toBe("unsupported");
  });
});
