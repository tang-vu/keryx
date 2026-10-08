import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { HeuristicEngine } from "./heuristic-engine";
import { ResilientEngine } from "./resilient-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { ReasoningInputLimitError, ReasoningOutputLimitError, type SynthInput, type SynthResult } from "./reasoning-engine";
import { parseTeachingProposalRequest } from "../research/teaching-proposals-request";
import { deliverTeachingProposals, type TeachingProposalPacket } from "../research/teaching-proposals";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { EVIDENCE_REVIEW_GUIDANCE } from "./evidence-review";
import { MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";

// Synthetic contract replay, not NASA evidence or a completed live lesson.
const question = "I teach grade 7. Propose a 10-minute classroom activity, two classification examples and one exit question with an answer. Write in English: explanation under 100 words. Label activities and invented examples as proposed.";
const facts = ["Weather describes atmospheric conditions over a short period.", "Climate describes average weather over a long period."];
const proposals = [
  { id: "t1", kind: "activity", text: "Sort the proposed short-term and long-term descriptions.", durationMinutes: 10, premiseIds: ["e1", "e2"], conditions: [] },
  { id: "t2", kind: "classification-example", text: "Proposed scenario: rain today.", answer: "Weather.", premiseIds: ["e1"], conditions: [] },
  { id: "t3", kind: "classification-example", text: "Proposed scenario: average rainfall over decades.", answer: "Climate.", premiseIds: ["e2"], conditions: [] },
  { id: "t4", kind: "exit-question", text: "Which concept describes a long-term weather average?", answer: "Climate.", premiseIds: ["e2"], conditions: [] },
];
function input(caller = question): SynthInput {
  return { question: caller, subClaims: ["What is weather?", "What is climate?"], generationFormat: "evidence-only",
    teachingRequest: parseTeachingProposalRequest(caller),
    gathered: [{ sourceId: "synthetic", sourceName: "Synthetic classroom reference", sourceKind: "public-reference",
      marker: "S1", itemId: "one", contentVersion: "v1", text: facts.join(" ") }] };
}
interface CapturedCall { system: string; user: string; cap?: number; packet: Record<string, unknown> }
type Mode = "malformed-proposals" | "excess-proposals" | "duplicate-proposals" | "wrong-duration" | "missing-premise" |
  "partial-proposals" | "missing-review" | "duplicate-review" | "wrong-digest" | "changed-premises" | "extra-review" |
  "no-factual-review" | "rejected-premise" | "rejected-proposal" | "invalid-first-row" | "unresolved" |
  "generation-limit" | "review-limit" | "generation-input" | "review-input";
class TeachingEngine extends JsonChatEngine {
  readonly name = "synthetic-teaching-engine";
  captured: CapturedCall[] = [];
  preflights = 0;
  constructor(private readonly mode?: Mode) { super(); }
  protected validateChatJsonInput(_model: string, _system: string, user: string) {
    const packet = JSON.parse(user);
    if (packet.teachingRequest || packet.teachingProposals) this.preflights++;
    if (this.mode === "generation-input" && packet.teachingRequest || this.mode === "review-input" && packet.teachingProposals)
      throw new ReasoningInputLimitError("Synthetic proposal addition refused");
  }
  protected async chatJson(_model: string, system: string, user: string, cap?: number) {
    const packet = JSON.parse(user);
    this.captured.push({ system, user, cap, packet });
    if (this.captured.length === 1) {
      if (this.mode === "generation-limit") throw new ReasoningOutputLimitError(cap!);
      const options = packet.quoteOptions as Array<{ quoteId: string; marker: string; text: string }>;
      let evidence = facts.map((statement, claimIndex) => {
        const option = options.find(row => row.text === statement)!;
        return { claimIndex, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement };
      });
      let teachingProposals: unknown = structuredClone(proposals);
      if (this.mode === "malformed-proposals") teachingProposals = "supplier draft";
      if (this.mode === "excess-proposals") teachingProposals = Array(7).fill(proposals[0]);
      if (this.mode === "duplicate-proposals") teachingProposals = Array(2).fill(proposals[0]);
      if (this.mode === "wrong-duration") teachingProposals = [{ ...proposals[0], durationMinutes: 11 }];
      if (this.mode === "missing-premise") teachingProposals = [{ ...proposals[0], premiseIds: ["e32"] }];
      if (this.mode === "partial-proposals") teachingProposals = [{ ...proposals[0], text: "Fake [S99]" }, ...proposals.slice(1)];
      if (this.mode === "invalid-first-row") {
        evidence = [{ ...evidence[0], quoteId: "unknown", statement: "Unbound source claim." }, ...evidence];
        teachingProposals = proposals.map(row => ({ ...row, premiseIds: row.premiseIds.map(id => id === "e1" ? "e2" : "e3") }));
      }
      if (this.mode === "unresolved") evidence = evidence.map(row => ({ ...row, quoteId: "unknown" }));
      return { answer: "Unreviewed injected draft [S99].", citedMarkers: ["S99"], evidence, teachingProposals, conflicts: [] };
    }
    if (this.mode === "review-limit") throw new ReasoningOutputLimitError(cap!);
    const reviewedRows = packet.evidence as Array<{ index: number }>;
    const reviews = this.mode === "no-factual-review" ? [] : reviewedRows.map(row => ({ index: row.index, supportedFact: facts[row.index] ?? "Synthetic fact",
      support: this.mode === "rejected-premise" && row.index === 0 ? 0 : 0.9, statementSupport: 0.9 }));
    const candidate = packet.teachingProposals as TeachingProposalPacket | undefined;
    const teachingProposalReview = candidate ? { digest: candidate.digest, proposals: candidate.proposals.map(row => ({ id: row.id,
      premiseIds: [...row.premiseIds], premiseConsistency: "supported", conditions: "supported", instructionalConsistency: "supported",
      sourceAttribution: "supported", requestedScope: "supported", language: "supported" })) } : undefined;
    if (teachingProposalReview) {
      if (this.mode === "duplicate-review") teachingProposalReview.proposals[1] = teachingProposalReview.proposals[0];
      if (this.mode === "wrong-digest") teachingProposalReview.digest = "a".repeat(64);
      if (this.mode === "changed-premises") teachingProposalReview.proposals[0].premiseIds = ["e1"];
      if (this.mode === "extra-review") Object.assign(teachingProposalReview, { promoted: true });
      if (this.mode === "rejected-proposal") teachingProposalReview.proposals[0].instructionalConsistency = "unsupported";
    }
    return { reviews, ...(this.mode !== "missing-review" && teachingProposalReview ? { teachingProposalReview } : {}) };
  }
}
function finalDelivery(value: SynthInput, result: SynthResult) {
  const ledger = buildEvidenceLedger({ ...value, answer: result.answer, declaredMarkers: result.citedMarkers,
    proposedEvidence: result.evidence, finalAssessment: value.subClaims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
  const before = JSON.stringify(ledger, (_key, row) => row instanceof Set ? [...row] : row);
  const delivery = deliverTeachingProposals(value.teachingRequest!, result.teachingProposals?.reviewed, ledger,
    selectCitedStatements(result.evidence, ledger), result.teachingProposals?.preparationGaps);
  expect(JSON.stringify(ledger, (_key, row) => row instanceof Set ? [...row] : row)).toBe(before);
  return { ledger, delivery };
}
function wire(call: CapturedCall) { return { system: call.system, user: call.user, cap: call.cap }; }

describe("ordinary teaching generation and review", () => {
  it("uses the same two calls/caps and keeps every factual source context for independent review", async () => {
    const value = input(), baseline = new TeachingEngine(), engine = new TeachingEngine();
    const ordinary = { ...value, teachingRequest: undefined };
    const plain = await baseline.synthesize(ordinary), result = await engine.synthesize(value);
    expect(engine.calls).toHaveLength(2);
    expect(engine.captured.map(row => row.cap)).toEqual(baseline.captured.map(row => row.cap));
    expect(engine.captured.map(row => row.cap)).toEqual([2304, 1536]);
    expect(engine.captured[0].packet.teachingRequest).toEqual(value.teachingRequest);
    expect(engine.captured[0].packet.schema).toContain('"teachingProposals"');
    expect(engine.captured[0].system).toContain("at most 99 explanatory words collectively");
    expect(engine.captured[1].packet.evidence).toEqual(baseline.captured[1].packet.evidence);
    expect(engine.captured[1].system).toContain(EVIDENCE_REVIEW_GUIDANCE);
    expect(engine.captured[1].system).toContain("every packet premise statement against the requested explanation language");
    expect(engine.captured[1].packet.schema).toContain('"teachingProposalReview"');
    expect(Buffer.byteLength(engine.captured[1].system + engine.captured[1].user) + 1024).toBeLessThanOrEqual(MAX_EVIDENCE_REVIEW_INPUT_BYTES);
    expect(result.evidence).toEqual(plain.evidence);
    expect(result).toMatchObject({ answer: "[S1]", citedMarkers: ["S1"], evidenceReview: "completed" });
    const { ledger, delivery } = finalDelivery(value, result);
    expect(delivery.complete).toBe(true);
    expect(delivery.proposals).toHaveLength(4);
    expect(delivery.proposals[0].premises.map(row => row.statement.text)).toEqual(facts);
    expect(ledger.evidence.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
  });
  it("binds eN to exact resolved positions, including rejected earlier rows", async () => {
    const value = input(), engine = new TeachingEngine("invalid-first-row"), result = await engine.synthesize(value);
    const packet = engine.captured[1].packet.teachingProposals as TeachingProposalPacket;
    expect(packet.premises.map(row => row.id)).toEqual(["e2", "e3"]);
    expect(packet.premises.map(row => row.statement.quote)).toEqual(facts);
    expect(engine.captured[1].packet.evidence).toMatchObject([{ index: 1 }, { index: 2 }]);
    expect(result.evidence[0].support).toBe(0);
    expect(finalDelivery(value, result).delivery.complete).toBe(true);
  });
  it.each(["malformed-proposals", "excess-proposals", "duplicate-proposals", "wrong-duration", "missing-premise"] as const)("retains the factual review when generation proposals fail %s", async mode => {
    const engine = new TeachingEngine(mode), result = await engine.synthesize(input());
    expect(engine.calls).toHaveLength(2);
    expect(engine.captured[1].system).toBe(EVIDENCE_REVIEW_GUIDANCE);
    expect(engine.captured[1].packet.teachingProposals).toBeUndefined();
    expect(result.evidence.every(row => row.support === 0.9 && row.statementSupport === 0.9)).toBe(true);
    expect(result.teachingProposals!.preparationGaps.length).toBeGreaterThan(0);
    expect(result.teachingProposals!.reviewed).toBeUndefined();
  });
  it.each(["missing-review", "duplicate-review", "wrong-digest", "changed-premises", "extra-review"] as const)("retains facts when proposal review fails %s", async mode => {
    const engine = new TeachingEngine(mode), result = await engine.synthesize(input());
    expect(engine.calls).toHaveLength(2);
    expect(result.evidence.every(row => row.support === 0.9 && row.statementSupport === 0.9)).toBe(true);
    expect(result.teachingProposals!.reviewed).toBeUndefined();
    expect(finalDelivery(input(), result).delivery.proposals).toEqual([]);
  });
  it("keeps separately admitted proposal siblings and explicit malformed-row gaps", async () => {
    const value = input(), result = await new TeachingEngine("partial-proposals").synthesize(value);
    const { delivery } = finalDelivery(value, result);
    expect(delivery.complete).toBe(false);
    expect(delivery.proposals.map(row => row.proposal.id)).toEqual(["t2", "t3", "t4"]);
    expect(delivery.gaps).toContainEqual({ reason: "invalid-proposal" });
  });
  it.each(["rejected-proposal", "rejected-premise"] as const)("withholds only the affected proposal dependencies after %s", async mode => {
    const value = input(), result = await new TeachingEngine(mode).synthesize(value);
    const { delivery } = finalDelivery(value, result);
    expect(delivery.complete).toBe(false);
    expect(delivery.proposals.some(row => row.proposal.id === "t1")).toBe(false);
    expect(delivery.proposals.some(row => row.proposal.id === "t4")).toBe(true);
  });
  it("a positive proposal judgment cannot rescue missing factual review", async () => {
    const value = input(), result = await new TeachingEngine("no-factual-review").synthesize(value);
    expect(result.teachingProposals!.reviewed!.acceptedProposalIds).toHaveLength(4);
    expect(result.evidence.every(row => row.support === 0 && row.statementSupport === 0)).toBe(true);
    expect(finalDelivery(value, result).delivery.proposals).toEqual([]);
  });
  it("does not call a proposal-only verifier when every quote is unresolved", async () => {
    const value = input(), engine = new TeachingEngine("unresolved"), result = await engine.synthesize(value);
    expect(engine.calls).toHaveLength(1);
    expect(result.teachingProposals!.reviewed).toBeUndefined();
    expect(finalDelivery(value, result).delivery.proposals).toEqual([]);
  });
  it("generation truncation keeps the existing ceiling and admits no review/retry", async () => {
    const engine = new TeachingEngine("generation-limit");
    await expect(engine.synthesize(input())).rejects.toMatchObject({ outputTokenLimit: 2304 });
    expect(engine.calls).toHaveLength(1);
  });
  it("review truncation keeps safe diagnostics and withholds facts/proposals without a retry", async () => {
    const value = input(), engine = new TeachingEngine("review-limit"), result = await engine.synthesize(value);
    expect(engine.calls).toHaveLength(2);
    expect(result).toMatchObject({ synthesisOutputLimit: { stage: "review", outputTokenLimit: 1536 }, evidenceReview: "unavailable" });
    expect(result.evidence.every(row => row.support === 0 && row.statementSupport === 0)).toBe(true);
    expect(finalDelivery(value, result).delivery.proposals).toEqual([]);
  });
  it.each(["generation-input", "review-input"] as const)("locally refuses %s additions, preserving factual-only calls byte for byte", async mode => {
    const value = input(), plain = new TeachingEngine(), engine = new TeachingEngine(mode);
    await plain.synthesize({ ...value, teachingRequest: undefined });
    const result = await engine.synthesize(value);
    const index = mode === "generation-input" ? 0 : 1;
    expect(wire(engine.captured[index])).toEqual(wire(plain.captured[index]));
    expect(engine.calls).toHaveLength(2);
    expect(result.evidence.every(row => row.support === 0.9 && row.statementSupport === 0.9)).toBe(true);
    expect(result.teachingProposals!.reviewed).toBeUndefined();
  });
  it("keeps the full factual packet when adding the original caller would exceed 32KB", async () => {
    const value = input(question + " Classroom context ".repeat(1350));
    expect(value.teachingRequest).toBeDefined();
    const plain = new TeachingEngine(), engine = new TeachingEngine();
    await plain.synthesize({ ...value, teachingRequest: undefined });
    const result = await engine.synthesize(value);
    expect(engine.captured[0].packet.teachingRequest).toBeDefined();
    expect(wire(engine.captured[1])).toEqual(wire(plain.captured[1]));
    expect(engine.calls).toHaveLength(2);
    expect(result.evidence.every(row => row.support === 0.9 && row.statementSupport === 0.9)).toBe(true);
    expect(result.teachingProposals!.reviewed).toBeUndefined();
  });
});

describe("teaching opt-in boundaries and fallback", () => {
  it.each(["absent", "changed-request", "changed-question", "decision-brief", "legacy-private"])("preserves historical factual contracts for %s", async mode => {
    const value = input();
    if (mode === "absent") value.teachingRequest = undefined;
    if (mode === "changed-request") value.teachingRequest = { ...value.teachingRequest!, durationMinutes: 11 };
    if (mode === "changed-question") value.question += " changed";
    if (mode === "decision-brief") value.answerFormat = "decision-brief";
    if (mode === "legacy-private") value.generationFormat = undefined;
    const baseline = new TeachingEngine(), engine = new TeachingEngine();
    await baseline.synthesize({ ...value, teachingRequest: undefined });
    const result = await engine.synthesize(value);
    expect(engine.captured.map(wire)).toEqual(baseline.captured.map(wire));
    expect(engine.preflights).toBe(0);
    expect(result.teachingProposals).toBeUndefined();
  });
  it("source/model proposal content cannot create the trusted opt-in", async () => {
    const value = input(); value.teachingRequest = undefined;
    value.gathered[0].text += " " + question;
    const engine = new TeachingEngine(), result = await engine.synthesize(value);
    expect(engine.captured[0].packet.teachingRequest).toBeUndefined();
    expect(engine.captured[1].packet.teachingProposals).toBeUndefined();
    expect(result.teachingProposals).toBeUndefined();
  });
  it("heuristic fallback cannot invent a reviewed teaching bundle", async () => {
    const value = input(), engine = new HeuristicEngine(), plain = await engine.synthesize({ ...value, teachingRequest: undefined });
    expect(await engine.synthesize(value)).toEqual(plain);
    expect(plain.teachingProposals).toBeUndefined();
  });
  it("resilience forwards an admitted runtime review intact without fallback", async () => {
    const value = input(), primary = new TeachingEngine(), fallback = new HeuristicEngine();
    const fallbackCall = vi.spyOn(fallback, "synthesize");
    const engine = new ResilientEngine(primary, fallback, 0, new MemoryReasoningCircuitStore());
    const result = await engine.synthesize(value);
    expect(primary.calls).toHaveLength(2);
    expect(fallbackCall).not.toHaveBeenCalled();
    expect(finalDelivery(value, result).delivery.complete).toBe(true);
  });
  it("a provider failure's heuristic fallback remains explicit and cannot promote proposals", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const value = input(), primary = new TeachingEngine("generation-limit");
    const engine = new ResilientEngine(primary, new HeuristicEngine(), 0, new MemoryReasoningCircuitStore());
    const result = await engine.synthesize(value);
    expect(primary.calls).toHaveLength(1);
    expect(engine.effectiveName).toContain("heuristic");
    expect(result.teachingProposals).toBeUndefined();
    expect(finalDelivery(value, result).delivery.proposals).toEqual([]);
    warn.mockRestore();
  });
  it("review bundle JSON cannot gain proposal delivery authority", async () => {
    const value = input(), result = await new TeachingEngine().synthesize(value);
    const copied = JSON.parse(JSON.stringify(result)) as SynthResult;
    expect(finalDelivery(value, copied).delivery.proposals).toEqual([]);
  });
  it("legacy wire prompts have an explicit stable hash", async () => {
    const value = input(); value.generationFormat = undefined; value.teachingRequest = undefined;
    const engine = new TeachingEngine(); await engine.synthesize(value);
    const observed = createHash("sha256").update(JSON.stringify(engine.captured.map(wire))).digest("hex");
    // Independently executed unchanged e9077764 baseline: two calls, 2304/1536.
    expect(observed).toBe("3348c662f608e6a0c4cbf1ec08c44118d949930c675828a1aa581228751dc186");
  });
});
