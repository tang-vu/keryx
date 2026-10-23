import { describe, expect, it, vi } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { applyEvidenceReview, EVIDENCE_REVIEW_GUIDANCE } from "./evidence-review";
import { ORDINARY_SCOPE_REVIEW_GUIDANCE, ordinaryScopeReviewedResponse } from "./ordinary-evidence-review";
import { OrdinaryComputeBudget, bindOrdinaryComputeBudget } from "./ordinary-compute-budget";
import { buildEvidenceReviewInput, MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { evidenceContext } from "./evidence-context";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import type { ProposedEvidence, SynthInput } from "./reasoning-engine";

const statement = "The documented API uses HTTP 429 for rate-limited requests.";
const proposal: ProposedEvidence = { claimIndex: 0, marker: "S1", quote: statement, support: 0.6, statement };
const direct = { index: 0, supportedFact: "The API uses HTTP 429 for rate-limited requests.", questionScope: "direct",
  statementScope: "preserved", support: 0.99, statementSupport: 0.99 };
const reviewed = (reviews: unknown[]) => applyEvidenceReview([proposal], ordinaryScopeReviewedResponse({ reviews }, [proposal]));

describe("ordinary scope judgments can only reduce evidence authority", () => {
  it("does not accept numeric scores without explicit fact, question-scope and statement-scope judgments", () => {
    for (const row of [{ index: 0, support: 0.99, statementSupport: 0.99 },
      { ...direct, questionScope: "related" }, { ...direct, questionScope: "unrelated" },
      { ...direct, questionScope: "unknown" }, { ...direct, supportedFact: "" },
      { ...direct, supportedFact: "x".repeat(321) }]) {
      expect(reviewed([row])[0]).toMatchObject({ support: 0, statementSupport: 0 });
    }
  });

  it("withholds an overgeneralized sentence even when its quote is directly relevant", () => {
    for (const statementScope of [undefined, "generalized", "unknown", "other"]) {
      expect(reviewed([{ ...direct, statementScope }])[0]).toMatchObject({ support: 0.6, statementSupport: 0 });
    }
    expect(reviewed([direct])[0]).toMatchObject({ support: 0.6, statementSupport: 0.99 });
    expect(reviewed([direct, direct])[0]).toMatchObject({ support: 0, statementSupport: 0 });
  });

  it("refuses hostile/malformed or excessive rows without reading getters", () => {
    const getter = vi.fn(() => [direct]);
    const outer = Object.defineProperty({}, "reviews", { get: getter });
    const row = Object.defineProperty({ ...direct }, "supportedFact", { get: getter });
    for (const value of [null, {}, outer, { reviews: [row] }, { reviews: Array(33).fill(direct) }]) {
      expect(applyEvidenceReview([proposal], ordinaryScopeReviewedResponse(value, [proposal]))[0])
        .toMatchObject({ support: 0, statementSupport: 0 });
    }
    expect(getter).not.toHaveBeenCalled();
  });
});

class ScopeEngine extends JsonChatEngine {
  readonly name = "controlled-scope-review";
  readonly requests: Array<{ system: string; packet: Record<string, unknown> }> = [];
  constructor(private readonly review: Record<string, unknown>) { super(); }
  protected async chatJson(_model: string, system: string, user: string) {
    const packet = JSON.parse(user);
    this.requests.push({ system, packet });
    if (this.requests.length === 2) return { reviews: [this.review] };
    const option = (packet.quoteOptions as Array<{ quoteId: string }>)[0];
    return { evidence: [{ claimIndex: 0, marker: "S1", quoteId: option.quoteId, support: 0.9, statement }], conflicts: [] };
  }
}
const input: SynthInput = { question: "Which response represents rate limiting in the documented API?",
  subClaims: ["Which HTTP response represents rate limiting?"], generationFormat: "evidence-only",
  gathered: [{ sourceId: "public:api-original", sourceName: "Original API documentation", sourceKind: "public-reference",
    marker: "S1", text: statement, itemUrl: "https://api.example.invalid/docs/v1/rate-limits", itemTitle: "API v1 response contract" }] };

describe("ordinary engine review and retained-original boundary", () => {
  it("withholds a related-domain proposal after the actual generation/review path", async () => {
    const engine = new ScopeEngine({ ...direct, questionScope: "related" });
    bindOrdinaryComputeBudget(engine, new OrdinaryComputeBudget());
    const result = await engine.synthesize(input);
    expect(result.evidenceReview).toBe("completed");
    expect(result.evidence![0]).toMatchObject({ support: 0, statementSupport: 0 });
    const ledger = buildEvidenceLedger({ question: input.question, subClaims: input.subClaims, gathered: input.gathered,
      answer: result.answer, declaredMarkers: result.citedMarkers, proposedEvidence: result.evidence!,
      finalAssessment: [{ claim: input.subClaims[0], coverage: 0.9, coveredBy: ["S1"] }] });
    expect(ledger.acceptedMarkers.size).toBe(0);
    expect(selectCitedStatements(result.evidence!, ledger)).toEqual([]);
    expect(engine.requests[1].system).toContain(ORDINARY_SCOPE_REVIEW_GUIDANCE);
    expect((engine.requests[1].packet.evidence as Array<{ source: unknown }>)[0].source)
      .toMatchObject({ itemTitle: "API v1 response contract" });
  });

  it("retains direct, scope-preserving statements through the same literal evidence ledger", async () => {
    const engine = new ScopeEngine(direct);
    bindOrdinaryComputeBudget(engine, new OrdinaryComputeBudget());
    const result = await engine.synthesize(input);
    const ledger = buildEvidenceLedger({ question: input.question, subClaims: input.subClaims, gathered: input.gathered,
      answer: result.answer, declaredMarkers: result.citedMarkers, proposedEvidence: result.evidence!,
      finalAssessment: [{ claim: input.subClaims[0], coverage: 0.9, coveredBy: ["S1"] }] });
    expect(ledger.acceptedMarkers.has("S1")).toBe(true);
    expect(selectCitedStatements(result.evidence!, ledger)).toHaveLength(1);
  });

  it("leaves unbound private/fixed-model review prompts and legacy judgments unchanged", async () => {
    const engine = new ScopeEngine({ index: 0, support: 0.9, statementSupport: 0.9 });
    const result = await engine.synthesize(input);
    expect(result.evidence![0]).toMatchObject({ support: 0.9, statementSupport: 0.9 });
    expect(engine.requests[1].system).toBe(EVIDENCE_REVIEW_GUIDANCE);
    expect(engine.requests[1].packet.schema).not.toContain("questionScope");
    expect((engine.requests[1].packet.evidence as Array<{ source: object }>)[0].source).not.toHaveProperty("itemTitle");
  });

  it("keeps the same review-byte cap and omits complete rows instead of clipping source context", () => {
    const options = buildQuoteOptions(evidenceContext(input.question, input.subClaims, input.gathered), input.gathered);
    const option = options[0];
    const proposals = resolveQuoteEvidence(Array.from({ length: 32 }, () => ({ claimIndex: 0,
      marker: "S1", quoteId: option.quoteId, support: 0.9, statement })), options);
    const subClaims = ["Requested API constraint and its exact retained context. ".repeat(80)];
    const result = buildEvidenceReviewInput({ proposals, options, gathered: input.gathered, subClaims, ordinaryScope: true });
    const packet = JSON.parse(result.json);
    expect(result.reviewedIndexes.size).toBeGreaterThan(0);
    expect(result.reviewedIndexes.size).toBeLessThan(32);
    expect(Buffer.byteLength(result.json + EVIDENCE_REVIEW_GUIDANCE + ORDINARY_SCOPE_REVIEW_GUIDANCE) + 1024)
      .toBeLessThanOrEqual(MAX_EVIDENCE_REVIEW_INPUT_BYTES);
    for (const entry of packet.evidence) expect(entry.question).toBe(subClaims[0]);
  });
});
