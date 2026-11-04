import { describe, expect, it } from "vitest";
import { buildEvidenceReviewInput, MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";
import { parseResearchPlan } from "./research-plan";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { applyEvidenceReview, EVIDENCE_REVIEW_GUIDANCE } from "./evidence-review";
import { ORDINARY_SCOPE_REVIEW_GUIDANCE } from "./ordinary-evidence-review";
import { JsonChatEngine } from "./json-chat-engine";
import { OrdinaryComputeBudget, bindOrdinaryComputeBudget } from "./ordinary-compute-budget";
import type { SynthInput } from "./reasoning-engine";

const claim = "What does provider-side idempotency guarantee for a repeated send attempt?";
const quote = "A provider that supports idempotency keys can deduplicate repeated requests carrying the same key.";
function fixture(question = "The provider does not support idempotency keys. How should an unknown outcome be handled?") {
  const subClaims = [claim];
  const gathered: SynthInput["gathered"] = [{ marker: "S1", sourceId: "scope-fixture", sourceName: "Synthetic scope fixture",
    sourceKind: "public-reference", itemUrl: "https://example.invalid/scope", contentVersion: "v1", text: quote }];
  const options = buildQuoteOptions(evidenceContext(question, subClaims, gathered), gathered);
  const proposals = resolveQuoteEvidence([{ claimIndex: 0, marker: "S1", quoteId: options[0].quoteId,
    support: 0.9, statement: "A supporting provider can deduplicate repeated requests with the same key." }], options);
  return { originalQuestion: question, ordinaryScope: true, subClaims, gathered, options, proposals };
}

describe("unchanged caller scope in ordinary review", () => {
  it("distinguishes incompatible caller conditions even when accepted noncomparison targets are identical", () => {
    const a = fixture("The provider supports idempotency keys. How should an unknown outcome be handled?");
    const b = fixture();
    for (const f of [a, b]) f.subClaims = parseResearchPlan(f.originalQuestion,
      { status: "complete", constraints: [f.originalQuestion], claims: [claim] });
    expect(a.subClaims).toEqual(b.subClaims);
    const first = buildEvidenceReviewInput(a), second = buildEvidenceReviewInput(b);
    expect([...first.reviewedIndexes]).toEqual([0]); expect([...second.reviewedIndexes]).toEqual([0]);
    expect(JSON.parse(first.json).originalQuestion).toBe(a.originalQuestion);
    expect(JSON.parse(second.json).originalQuestion).toBe(b.originalQuestion);
    expect(first.json).not.toBe(second.json);
    expect(JSON.parse(first.json).evidence).toEqual(JSON.parse(second.json).evidence);
    expect(ORDINARY_SCOPE_REVIEW_GUIDANCE).toContain("not evidence, factual truth");
    expect(ORDINARY_SCOPE_REVIEW_GUIDANCE).toContain("refute a caller premise");
  });
  it.each([undefined, "", "  \r\n", "malformed\ud800", 42, null])("withholds review authority for missing or invalid caller context %j", value => {
    const f = fixture(), input = buildEvidenceReviewInput({ ...f, originalQuestion: value as string });
    expect([...input.reviewedIndexes]).toEqual([]); expect(JSON.parse(input.json).evidence).toEqual([]);
    expect(applyEvidenceReview(f.proposals, { reviews: [{ index: 0, support: 1 }] }, input.reviewedIndexes)[0].support).toBe(0);
  });
  it.each(["  Keep all conditions.\r\n  Preserve source version V2.  ", "条件：不支持幂等键。\u2028Giữ nguyên điều kiện và https://example.invalid/v2?q=3#limits 😀."])
    ("retains exact original whitespace, Unicode, URL and condition bytes: %s", originalQuestion => {
      const f = fixture(originalQuestion), before = structuredClone(f);
      const packet = JSON.parse(buildEvidenceReviewInput(f).json);
      expect(packet.originalQuestion).toBe(originalQuestion); expect(f).toEqual(before);
      expect(packet.evidence[0].quote).toBe(quote); expect(packet.evidence[0].context.text).toContain(quote);
    });
  it("keeps the complete UTF-8 request and source contexts inside the existing shared input bound", () => {
    const f = fixture("Caller condition: " + "界".repeat(2_000));
    f.subClaims = [claim.repeat(40)]; f.proposals = Array.from({ length: 32 }, () => ({ ...f.proposals[0] }));
    const input = buildEvidenceReviewInput(f), packet = JSON.parse(input.json);
    expect(input.reviewedIndexes.size).toBeGreaterThan(0); expect(input.reviewedIndexes.size).toBeLessThan(32);
    expect(Buffer.byteLength(input.json + EVIDENCE_REVIEW_GUIDANCE + ORDINARY_SCOPE_REVIEW_GUIDANCE) + 1024)
      .toBeLessThanOrEqual(MAX_EVIDENCE_REVIEW_INPUT_BYTES);
    expect(packet.originalQuestion).toBe(f.originalQuestion);
    for (const row of packet.evidence) {
      expect(row.question).toBe(f.subClaims[0]); expect(row.context.text).toBe(f.options[0].context);
    }
  });
  it("withholds all rows when the full request alone cannot fit instead of clipping its conditions", () => {
    const f = fixture("界".repeat(11_000)), input = buildEvidenceReviewInput(f);
    expect(input.reviewedIndexes.size).toBe(0); expect(JSON.parse(input.json).evidence).toEqual([]);
    expect(JSON.parse(input.json)).not.toHaveProperty("originalQuestion");
    expect(f.originalQuestion).toHaveLength(11_000);
  });
  it.each([false, undefined])("leaves legacy/private packet bytes exact when ordinary enrollment is %j", ordinaryScope => {
    const f = fixture();
    const without = buildEvidenceReviewInput({ ...f, ordinaryScope, originalQuestion: undefined });
    for (const originalQuestion of [f.originalQuestion, "\ud800", "界".repeat(11_000)]) {
      const withQuestion = buildEvidenceReviewInput({ ...f, ordinaryScope, originalQuestion });
      expect(withQuestion.json).toBe(without.json); expect(withQuestion.reviewedIndexes).toEqual(without.reviewedIndexes);
      expect(JSON.parse(withQuestion.json)).not.toHaveProperty("originalQuestion");
    }
  });
  it.each(["span", "URL", "context"])("does not let full caller context repair a broken %s binding", mode => {
    const f = fixture();
    if (mode === "span") f.proposals[0].quoteSpan!.start++;
    if (mode === "URL") f.gathered[0].itemUrl = "https://example.invalid/changed";
    if (mode === "context") f.options[0].context = "An unrelated source assertion.";
    expect(buildEvidenceReviewInput(f).reviewedIndexes.size).toBe(0);
  });
});

class CallerScopeEngine extends JsonChatEngine {
  readonly name = "synthetic-caller-scope";
  readonly packets: Array<Record<string, unknown>> = [];
  protected async chatJson(_model: string, _system: string, user: string) {
    const packet = JSON.parse(user); this.packets.push(packet);
    if (this.packets.length === 2) return { reviews: [{ index: 0, supportedFact: quote,
      questionScope: "related", statementScope: "preserved", support: 0.99, statementSupport: 0.99 }] };
    return { evidence: [{ claimIndex: 0, marker: "S1", quoteId: (packet.quoteOptions as Array<{ quoteId: string }>)[0].quoteId,
      support: 0.9, statement: "A supporting provider can deduplicate repeated requests with the same key." }], conflicts: [] };
  }
}
it("passes the exact synthesis request through one existing ordinary review and keeps scope judgments withholding-only", async () => {
  const f = fixture(), engine = new CallerScopeEngine(); bindOrdinaryComputeBudget(engine, new OrdinaryComputeBudget());
  const result = await engine.synthesize({ question: f.originalQuestion, subClaims: f.subClaims, gathered: f.gathered, generationFormat: "evidence-only" });
  expect(engine.packets).toHaveLength(2); expect(engine.packets[1].originalQuestion).toBe(f.originalQuestion);
  expect(result.evidenceReview).toBe("completed"); expect(result.evidence![0]).toMatchObject({ support: 0, statementSupport: 0 });
});
