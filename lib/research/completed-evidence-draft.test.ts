// Synthetic in-memory storage exercises the real retained
// ledger and draft/export gates; it is not an expert or live-read measurement.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { fixtureEvidenceSpans } from "../../test-support/evidence-fixtures";
import { sourceItemIdentity } from "../sources/source-item-asset";
import { contentBodyHash } from "../sources/content-receipt";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import type { QueryRun } from "../types";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { buildEvidenceDraft, parseEvidenceDraftRequest, retainedDraftExcerpts } from "./evidence-draft";
import { assertDraftCitationParity } from "./evidence-draft-parity";
import { completedReadSelectionSchema, loadCompletedEvidenceDraft, MAX_COMPLETED_SNAPSHOT_BYTES, type CompletedEvidenceDraftRequest } from "./completed-evidence-draft";

const wallet = `0x${"1".repeat(40)}`, id = `prv_${"a".repeat(64)}`, baseUrl = "https://keryx.cc", network = "eip155:5042";
const savedAt = "2026-10-12T02:00:00.000Z", workerId = "12345678-1234-4234-8234-123456789abc";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function fixture() {
  const draft = evidenceDraftFixture(), paper = draft.workspace.entries[0].paper;
  const quote = draft.reports[0].evidence![0].quote, claim = draft.reports[0].subClaims[0];
  const body = `Methods\n${quote}\nThis is a bounded fixture body, not scientific acceptance.`;
  const identity = sourceItemIdentity({ id: "paper-v1", sourceId: "original-paper", title: paper.title,
    summary: "Fixture preview", content: body, link: paper.url, bodyHash: contentBodyHash(body), deliveryKind: "full_text" });
  const gathered = { ...identity, sourceId: "original-paper", sourceName: "Original", marker: "S1", text: body };
  const answer = `The retained method is described [S1].`;
  const ledger = buildEvidenceLedger({ question: "Read the exact paper", subClaims: [claim], gathered: [gathered], answer,
    declaredMarkers: ["S1"], proposedEvidence: fixtureEvidenceSpans([gathered], [{ claimIndex: 0, marker: "S1", quote, support: 0.8 }]) });
  const run: QueryRun = { id, question: "Read the exact paper", budget: 0.05, researchMode: "deep", asker: wallet,
    origin: "a2a", paymentMode: "real", fundingOwner: "treasury", answer, engine: "fixture-existing-gate",
    createdAt: "2026-10-12T01:59:00.000Z", subClaims: [claim], evidence: ledger.evidence, claimCoverage: ledger.claimCoverage,
    decisions: [{ ...identity, sourceId: "original-paper", sourceName: "Original", action: "BUY", price: 0.01,
      rationale: "Fixture read", targets: [0], expectedValue: 0.8, confidence: 0.8 }],
    citations: [{ ...identity, sourceId: "original-paper", sourceName: "Original", marker: "S1", weight: 1, reward: 0.001, rationale: "Fixture citation" }],
    totalSpent: 0.011, totalToCreators: 0.011, trace: [] };
  const intent = { id, submission: { request: { question: run.question, budget: run.budget, researchMode: "deep",
    model: null, packageVersion: "1.0.0", responseMode: "async" }, salt: `0x${"b".repeat(64)}`,
    payment: { signature: `0x${"c".repeat(130)}`, authorization: { from: wallet, to: `0x${"2".repeat(40)}`,
      nonce: `0x${"d".repeat(64)}`, value: "60000", validAfter: "1", validBefore: "2" } } },
    requirement: { network, payTo: `0x${"2".repeat(40)}` }, merchants: {} } as unknown as PrivateResearchIntent;
  let saved = { id, format: "query-run-v1" as const, savedAt, serializedRun: JSON.stringify(run) };
  const db = { getPrivateResearchIntent: vi.fn(async () => intent),
    getPrivateResearchExecution: vi.fn(async () => ({ id, workerId, startedAt: "2026-10-12T01:00:00.000Z" })),
    getPrivateResearchInterruption: vi.fn(async () => null), getPrivateResearchResult: vi.fn(async () => saved) };
  const input: CompletedEvidenceDraftRequest = { version: 1, capability: "owned-private-completed-read-v1", baseUrl, network,
    workspace: draft.workspace, selection: { id, savedAt, snapshotSha256: sha(saved.serializedRun), question: run.question,
      budget: run.budget, researchMode: "deep", sources: [{ sourceId: gathered.sourceId, itemId: identity.itemId,
        itemUrl: identity.itemUrl, contentVersion: identity.contentVersion }] } };
  const context = { db, wallet, baseUrl, network };
  const resnapshot = () => { saved = { ...saved, serializedRun: JSON.stringify(run) }; input.selection.snapshotSha256 = sha(saved.serializedRun); };
  return { context, input, run, intent, db, saved: () => saved, resnapshot, quote };
}
afterEach(() => vi.useRealTimers());
describe("owned completed private retained-ledger adapter", () => {
  it.each(["a".repeat(64), `sha256:${"b".repeat(64)}`, `ipfs:Qm${"a".repeat(44)}`, `ipfs:b${"a".repeat(20)}`])("accepts bounded valid URL/version constructors: %s", contentVersion => {
    const f = fixture(); f.input.selection.sources[0].contentVersion = contentVersion;
    expect(completedReadSelectionSchema.parse(f.input.selection)).toEqual(f.input.selection);
  });
  it.each(["http", "credentials", "port", "url-size", "url-surrogate", "version-size", "version-syntax", "version-surrogate"])("rejects invalid selection %s before private reads", async change => {
    const f = fixture(), row = f.input.selection.sources[0];
    if (change === "http") row.itemUrl = "http://papers.example/original";
    if (change === "credentials") row.itemUrl = "https://user:password@papers.example/original";
    if (change === "port") row.itemUrl = "https://papers.example:8443/original";
    if (change === "url-size") row.itemUrl = `https://papers.example/${"a".repeat(2048)}`;
    if (change === "url-surrogate") row.itemUrl = "https://papers.example/\ud800";
    if (change === "version-size") row.contentVersion = `ipfs:b${"a".repeat(200)}`;
    if (change === "version-syntax") row.contentVersion = `sha256:${"g".repeat(64)}`;
    if (change === "version-surrogate") row.contentVersion = `sha256:${"a".repeat(63)}\ud800`;
    await expect(loadCompletedEvidenceDraft(f.context, f.input)).rejects.toThrow();
    expect(f.db.getPrivateResearchIntent).not.toHaveBeenCalled();
  });
  it("uses genuine gate output, exact version/excerpt and one citation-to-reference set in all formats", async () => {
    const f = fixture(), original = f.saved().serializedRun, intentBytes = JSON.stringify(f.intent);
    const result = await loadCompletedEvidenceDraft(f.context, f.input);
    expect(result.draft.excerpts).toHaveLength(1); expect(result.draft.excerpts[0].quote).toBe(f.quote);
    expect(result.draft.excerpts[0].contentVersion).toBe(f.run.evidence![0].contentVersion);
    expect(result.draft.references.map(row => row.paper.url)).toEqual([f.input.selection.sources[0].itemUrl]);
    assertDraftCitationParity(result.exports, result.draft.references.map(row => ({ key: row.key, url: row.paper.url })));
    for (const format of ["markdown", "latex", "bibtex", "ris"] as const) expect(result.exports[format]).not.toBe("");
    expect(result.provenance).toMatchObject({ semanticSupport: "UNJUDGED", coverage: null, expert: null, payoutAuthority: false });
    expect(result.draft.origin).toBe("caller-supplied-report");
    expect(buildEvidenceDraft(result.editableRequest).origin).toBe("caller-supplied-report");
    expect(result.editableRequest.workspace.entries[0].notes).toBe("");
    expect(f.saved().serializedRun).toBe(original); expect(JSON.stringify(f.intent)).toBe(intentBytes);
    expect(f.run.totalSpent).toBe(0.011); expect(f.run.citations[0].reward).toBe(0.001);
    for (const read of Object.values(f.db)) {
      expect(read).toHaveBeenCalledTimes(2); expect(read).toHaveBeenCalledWith(f.input.selection.id, wallet);
    }
    expect(JSON.stringify(result)).not.toContain(f.intent.submission.payment.signature);
    expect(JSON.stringify(result)).not.toContain(f.intent.submission.payment.authorization.nonce);
    expect(JSON.stringify(result)).not.toContain(workerId);
    expect(JSON.stringify(result)).not.toContain("totalSpent");
  });
  it("accepts existing public raw/normalized hash representations without rewriting either or deriving payout", async () => {
    const f = fixture(), provenance = { retrievedAt: "2026-10-12T01:00:00.000Z", publisherGroup: "arxiv.org",
      normalizedBodyHash: "e".repeat(64), extraction: "text" as const, truncated: true };
    for (const row of [f.run.citations[0], f.run.evidence![0], f.run.decisions[0]]) {
      row.contentVersion = "f".repeat(64); delete row.contentReceipt; row.webProvenance = provenance; row.sourceKind = "public-reference";
    }
    f.run.evidence![0].qualifiesForReward = false; f.run.citations[0].reward = 0;
    f.input.selection.sources[0].contentVersion = "f".repeat(64); f.resnapshot();
    const result = await loadCompletedEvidenceDraft(f.context, f.input);
    expect(result.draft.excerpts[0].contentVersion).toBe("f".repeat(64)); expect(result.provenance.payoutAuthority).toBe(false);
  });
  it.each(["intent", "execution", "result", "interrupted", "cross-payer"])("refuses missing/noncompleted/cancelled/foreign %s", async change => {
    const f = fixture();
    if (change === "intent") f.db.getPrivateResearchIntent.mockResolvedValue(null as never);
    if (change === "execution") f.db.getPrivateResearchExecution.mockResolvedValue(null as never);
    if (change === "result") f.db.getPrivateResearchResult.mockResolvedValue(null as never);
    if (change === "interrupted") f.db.getPrivateResearchInterruption.mockResolvedValue({ reason: "worker-interrupted", recordedAt: savedAt } as never);
    if (change === "cross-payer") f.intent.submission.payment.authorization.from = `0x${"3".repeat(40)}`;
    await expect(loadCompletedEvidenceDraft(f.context, f.input)).rejects.toThrow();
    if (["intent", "cross-payer", "execution", "interrupted"].includes(change)) expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled();
  });
  it.each(["question", "budget", "researchMode", "savedAt", "digest", "network", "baseUrl", "capability", "excluded", "duplicate-selected", "forged-reports"])("refuses stale or forged selection %s", async change => {
    const f = fixture();
    if (change === "question") f.input.selection.question += " changed";
    if (change === "budget") f.input.selection.budget = 0.06;
    if (change === "researchMode") f.input.selection.researchMode = "quick";
    if (change === "savedAt") f.input.selection.savedAt = "2026-10-12T03:00:00.000Z";
    if (change === "digest") f.input.selection.snapshotSha256 = `sha256:${"0".repeat(64)}`;
    if (change === "network") f.input.network = "eip155:5042002";
    if (change === "baseUrl") f.input.baseUrl = "https://foreign.example";
    if (change === "capability") Object.assign(f.input, { capability: "public-archive" });
    if (change === "excluded") f.input.workspace.entries[0].screening = "exclude";
    if (change === "duplicate-selected") f.input.selection.sources.push({ ...f.input.selection.sources[0] });
    if (change === "forged-reports") Object.assign(f.input, { reports: evidenceDraftFixture().reports });
    await expect(loadCompletedEvidenceDraft(f.context, f.input)).rejects.toThrow();
    if (["network", "baseUrl", "capability", "excluded", "duplicate-selected", "forged-reports"].includes(change)) expect(f.db.getPrivateResearchIntent).not.toHaveBeenCalled();
  });
  it.each(["version", "item", "marker", "claim", "index", "duplicate-citation", "duplicate-evidence", "duplicate-identity", "bad-url", "surrogate", "unknown-field", "synthetic", "seed"])("refuses malformed/ambiguous/forged ledger %s", async change => {
    const f = fixture(), row = f.run.evidence![0];
    if (change === "version") row.contentVersion = `sha256:${"0".repeat(64)}`;
    if (change === "item") row.itemId = "another-original";
    if (change === "marker") row.marker = "S2";
    if (change === "claim") row.claim += " changed";
    if (change === "index") row.claimIndex = 64;
    if (change === "duplicate-citation") f.run.citations.push({ ...f.run.citations[0] });
    if (change === "duplicate-evidence") f.run.evidence!.push({ ...row });
    if (change === "duplicate-identity") f.run.citations.push({ ...f.run.citations[0], marker: "S2" });
    if (change === "bad-url") row.itemUrl = "http://arxiv.org/abs/other";
    if (change === "surrogate") row.quote = "Invalid \ud800 quote";
    if (change === "unknown-field") Object.assign(row, { authenticated: true });
    if (change === "synthetic") row.evidenceProvenance = "synthetic-demo";
    if (change === "seed") { row.itemUrl = "https://example.com/stablecoin-ledger/usdc-settles"; row.evidenceProvenance = undefined; }
    f.resnapshot(); await expect(loadCompletedEvidenceDraft(f.context, f.input)).rejects.toThrow();
  });
  it.each(["no-eligibility", "false-eligibility", "support", "not-in-answer", "no-body-hash", "no-receipt", "metadata", "receipt-mismatch", "skip"])("keeps %s explicitly unavailable, never promotes reward/status/model assertions", async change => {
    const f = fixture(), row = f.run.evidence![0];
    if (change === "no-eligibility") delete row.qualifiesForAnswer;
    if (change === "false-eligibility") row.qualifiesForAnswer = false;
    if (change === "support") row.support = 0.39;
    if (change === "not-in-answer") f.run.answer = "No marker";
    if (change === "no-body-hash") { delete row.contentReceipt!.bodyHash; delete f.run.citations[0].contentReceipt!.bodyHash; }
    if (change === "no-receipt") { delete row.contentReceipt; delete f.run.citations[0].contentReceipt; }
    if (change === "metadata") row.contentReceipt!.deliveryKind = "metadata_only";
    if (change === "receipt-mismatch") f.run.citations[0].contentReceipt = { ...f.run.citations[0].contentReceipt!, bodyHash: `0x${"0".repeat(64)}` };
    if (change === "skip") f.run.decisions[0].action = "SKIP";
    row.qualifiesForReward = false; f.resnapshot();
    const result = await loadCompletedEvidenceDraft(f.context, f.input);
    expect(result.draft.excerpts).toEqual([]); expect(result.draft.reading.unavailable).toHaveLength(1);
    expect(result.draft.reading.unread).toEqual([]); expect(result.exports.referenceCount).toBe(0);
  });
  it("keeps missing original URL/retained evidence unknown; title similarity and imported reports supply nothing", async () => {
    const f = fixture(); delete f.run.evidence![0].itemUrl; delete f.run.citations[0].itemUrl; f.resnapshot();
    const result = await loadCompletedEvidenceDraft(f.context, f.input);
    expect(result.draft.reading.unknown).toHaveLength(1); expect(result.draft.reading.unread).toEqual([]);
    expect(result.draft.reading.unavailable).toEqual([]); expect(result.draft.references).toEqual([]);
  });
  it.each(["snapshot", "intent", "claim"])("detects replacement of %s between bounded owner reads", async change => {
    const f = fixture();
    if (change === "snapshot") f.db.getPrivateResearchResult.mockResolvedValueOnce(f.saved()).mockResolvedValueOnce({ ...f.saved(), serializedRun: f.saved().serializedRun + " " });
    if (change === "intent") f.db.getPrivateResearchIntent.mockResolvedValueOnce(f.intent).mockResolvedValueOnce({ ...f.intent, submission: { ...f.intent.submission,
      payment: { ...f.intent.submission.payment, signature: `0x${"e".repeat(130)}` } } });
    if (change === "claim") f.db.getPrivateResearchExecution.mockResolvedValueOnce({ id, workerId, startedAt: "2026-10-12T01:00:00.000Z" })
      .mockResolvedValueOnce({ id, workerId: "12345678-1234-4234-8234-123456789abd", startedAt: "2026-10-12T01:00:00.000Z" });
    await expect(loadCompletedEvidenceDraft(f.context, f.input)).rejects.toThrow();
  });
  it("bounds storage waiting and raw snapshots; starts no later DB read after deadline", async () => {
    const f = fixture(); vi.useFakeTimers();
    f.db.getPrivateResearchIntent.mockImplementation(() => new Promise(() => {}));
    const result = loadCompletedEvidenceDraft(f.context, f.input); const rejected = expect(result).rejects.toMatchObject({ kind: "storage" });
    await vi.advanceTimersByTimeAsync(5001); await rejected;
    expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled(); expect(f.db.getPrivateResearchExecution).not.toHaveBeenCalled();
    const large = fixture(); large.db.getPrivateResearchResult.mockResolvedValue({ ...large.saved(), serializedRun: " ".repeat(MAX_COMPLETED_SNAPSHOT_BYTES + 1) });
    await expect(loadCompletedEvidenceDraft(large.context, large.input)).rejects.toThrow();
  });
  it("does not let a reused mutable adapter object erase the first snapshot's byte binding", async () => {
    const f = fixture(), shared = f.saved();
    f.db.getPrivateResearchResult.mockResolvedValueOnce(shared).mockImplementationOnce(async () => {
      shared.serializedRun += " "; return shared;
    });
    await expect(loadCompletedEvidenceDraft(f.context, f.input)).rejects.toThrow();
  });
  it("uses only the four reader ports; catches failures without writes, fallback, source/body/provider/payment calls", async () => {
    const f = fixture(), trapped = new Proxy(f.db, { get(target, property) {
      if (!(property in target)) throw new Error(`Forbidden port: ${String(property)}`);
      return Reflect.get(target, property);
    } });
    await loadCompletedEvidenceDraft({ ...f.context, db: trapped }, f.input);
    f.db.getPrivateResearchExecution.mockRejectedValue(new Error("SECRET_STORAGE_DETAILS"));
    await expect(loadCompletedEvidenceDraft(f.context, f.input)).rejects.toMatchObject({ kind: "storage", message: "Completed private read unavailable" });
  });
  it("retains exact portable gates without allowing copied data to self-authenticate", async () => {
    const f = fixture(), result = await loadCompletedEvidenceDraft(f.context, f.input);
    const portable = parseEvidenceDraftRequest(result.editableRequest);
    expect(retainedDraftExcerpts(portable)).toEqual(result.draft.excerpts);
    expect(buildEvidenceDraft(portable).origin).toBe("caller-supplied-report");
    Object.assign(portable, { provenance: result.provenance });
    expect(() => parseEvidenceDraftRequest(portable)).toThrow();
  });
});
