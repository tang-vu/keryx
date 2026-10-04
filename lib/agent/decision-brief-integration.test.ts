import { describe, expect, it } from "vitest";
import { JsonChatEngine } from "../llm/json-chat-engine";
import type { BriefCandidate, BriefPacket } from "../llm/decision-brief";
import type { SynthInput } from "../llm/reasoning-engine";
import { buildEvidenceLedger } from "./evidence-ledger";
import { deliverDecisionBrief } from "./decision-brief";
import { finalizeGroundedAnswer } from "./answer-grounding";

const privateContext = "INTERNAL_REVIEW_CONTEXT_NOT_PUBLIC";

class ScriptedBriefEngine extends JsonChatEngine {
  protected supportsDecisionBrief() { return true; }
  readonly name = "offline-scripted-brief-review";
  readonly payloads: Record<string, unknown>[] = [];
  constructor(private readonly generation: BriefCandidate,
    private readonly mode: "valid" | "bad-generation" | "review-outage" | "bad-review" = "valid") { super(); }
  protected async chatJson(_model: string, _system: string, user: string): Promise<Record<string, unknown>> {
    const payload = JSON.parse(user) as Record<string, unknown>;
    this.payloads.push(payload);
    if (!payload.packet) return this.mode === "bad-generation" ? { ...this.generation, answer: "UNREVIEWED_NARRATIVE" } : { ...this.generation };
    if (this.mode === "review-outage") throw new Error(`Private transport detail ${privateContext}`);
    const packet = payload.packet as BriefPacket;
    return { digest: this.mode === "bad-review" ? "foreign-packet" : packet.digest,
      facts: packet.candidate.facts.map(fact => ({ id: fact.id, status: "supported", support: fact.support - 0.1,
        quotes: fact.quoteIds.map(quoteId => ({ quoteId, status: "supported", support: fact.support - 0.1 })) })),
      actions: packet.candidate.actions.map(action => ({ id: action.id, status: "supported" })),
    };
  }
}

function scenario(independentFact: boolean, publicSource: boolean) {
  const input: SynthInput = { question: "Explain the original mechanism in arXiv:2606.02668v1.",
    subClaims: ["What mechanism does arXiv:2606.02668v1 describe?"], answerFormat: "decision-brief", gathered: [
      { sourceId: "original", sourceName: "Internal original fixture", marker: "S1",
        itemUrl: "https://arxiv.org/html/2606.02668v1", ...(publicSource ? { sourceKind: "public-reference" as const } : {}),
        text: `The fictional mechanism retains an original request. It rejects a changed request identifier. ${privateContext} describes additional caveats.` },
      { sourceId: "other-paper", sourceName: "Internal other-paper fixture", marker: "S2",
        itemUrl: "https://arxiv.org/html/2607.13716v1", text: "A different fictional protocol reuses the request after a timeout." },
    ] };
  const candidate: BriefCandidate = {
    facts: [{ id: "f1", targetIndex: 0, text: "ORPHAN_FACT combines both fictional mechanisms.", quoteIds: ["q0_0", "q1_0"], support: 0.8 }],
    actions: [{ id: "a1", text: "ORPHAN_ACTION relies on both mechanisms.", premiseIds: ["f1"], conditions: ["If both mechanisms apply."] }],
  };
  if (independentFact) {
    candidate.facts.push({ id: "f2", targetIndex: 0, text: "The fictional mechanism rejects a changed request identifier.", quoteIds: ["q0_1"], support: 0.6 });
    candidate.actions.push({ id: "a2", text: "Check the request identifier before relying on this mechanism.", premiseIds: ["f2"], conditions: ["If this fictional mechanism applies."] });
  }
  return { input, candidate };
}

describe("decision-brief engine to evidence and delivery integration", () => {
  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])("removes orphan quote/reward legs with independentFact=%s publicSource=%s", async (independentFact, publicSource) => {
    const { input, candidate } = scenario(independentFact, publicSource);
    const engine = new ScriptedBriefEngine(candidate);
    const synthesized = await engine.synthesize(input);
    expect(engine.payloads).toHaveLength(2);
    expect(synthesized.decisionBrief).toBeDefined();
    const ledger = buildEvidenceLedger({ subClaims: input.subClaims, gathered: input.gathered,
      answer: synthesized.answer, declaredMarkers: synthesized.citedMarkers, proposedEvidence: synthesized.evidence,
      finalAssessment: input.subClaims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1", "S2"] })),
    });
    // The exact-paper gate rejects S2, leaving an otherwise admissible S1 quote
    // leg. The all-facts-lost case must restrict this ledger before D-300 fallback.
    expect(ledger.droppedEvidence).toBe(1);
    expect(ledger.acceptedMarkers.has("S1")).toBe(true);
    const delivered = deliverDecisionBrief(synthesized.decisionBrief, ledger, input.question);
    expect(delivered).toBeDefined();
    expect(delivered!.facts).toBe(independentFact ? 1 : 0);
    expect(delivered!.actions).toBe(independentFact ? 1 : 0);
    const orphan = delivered!.ledger.evidence.find(item => item.quote.startsWith("The fictional mechanism retains"));
    expect(orphan).toMatchObject({ qualifiesForAnswer: false, qualifiesForReward: false });
    expect(delivered!.ledger.evidence.filter(item => item.qualifiesForReward)).toHaveLength(independentFact && !publicSource ? 1 : 0);
    expect(delivered!.ledger.acceptedMarkers.size).toBe(independentFact ? 1 : 0);
    expect(delivered!.ledger.claimCoverage[0].coverage).toBe(independentFact ? 0.5 : 0);
    const finalAnswer = delivered!.facts ? delivered!.answer : finalizeGroundedAnswer({
      question: input.question, answer: synthesized.answer, ledger: delivered!.ledger,
    });
    expect(finalAnswer).not.toContain("ORPHAN_FACT");
    expect(finalAnswer).not.toContain("ORPHAN_ACTION");
    expect(finalAnswer).not.toContain("The fictional mechanism retains an original request.");
    expect(finalAnswer).not.toContain("[S2]");
    expect(finalAnswer).not.toContain(privateContext);
    expect(JSON.stringify(delivered!.ledger)).not.toContain(privateContext);
    if (independentFact) expect(finalAnswer).toContain("Check the request identifier");
    else expect(finalAnswer).toContain("No supported answer");
    expect(JSON.stringify(engine.calls)).not.toContain(privateContext);
  });

  it.each(["bad-generation", "review-outage", "bad-review"] as const)("contains %s without exposing unreviewed prose, context or reward evidence", async mode => {
    const { input, candidate } = scenario(true, false);
    const engine = new ScriptedBriefEngine(candidate, mode);
    const synthesized = await engine.synthesize(input);
    expect(synthesized).toMatchObject({ answer: "", citedMarkers: [], evidence: [], evidenceReview: "unavailable" });
    expect(synthesized.decisionBrief).toBeUndefined();
    expect(JSON.stringify(synthesized)).not.toContain(privateContext);
    expect(JSON.stringify(synthesized)).not.toContain("UNREVIEWED_NARRATIVE");
    expect(engine.payloads).toHaveLength(mode === "bad-generation" ? 1 : 2);
    const ledger = buildEvidenceLedger({ subClaims: input.subClaims, gathered: input.gathered,
      answer: synthesized.answer, declaredMarkers: synthesized.citedMarkers, proposedEvidence: synthesized.evidence });
    expect(ledger.acceptedMarkers.size).toBe(0);
    expect(ledger.evidence).toEqual([]);
  });

  it("rejects ambiguous gathered source markers before generation or review", async () => {
    const { input, candidate } = scenario(false, false);
    input.gathered[1].marker = "S1";
    const engine = new ScriptedBriefEngine(candidate);
    const synthesized = await engine.synthesize(input);
    expect(engine.payloads).toHaveLength(0);
    expect(synthesized.evidence).toEqual([]);
    expect(synthesized.decisionBrief).toBeUndefined();
  });

  it("retains observed read truncation and source version in the independent review packet", async () => {
    const { input, candidate } = scenario(false, true);
    const provenance = { retrievedAt: "2026-10-04T00:00:00.000Z", publisherGroup: "arxiv.org",
      normalizedBodyHash: "b".repeat(64), extraction: "html" as const, truncated: true };
    input.gathered[0].webProvenance = provenance;
    input.gathered[0].contentVersion = "observed-body-version";
    const engine = new ScriptedBriefEngine(candidate);
    await engine.synthesize(input);
    const packet = engine.payloads[1].packet as BriefPacket;
    expect(packet.sources[0]).toMatchObject({ webProvenance: {
      truncated: true, extraction: "html", retrievedAt: provenance.retrievedAt, normalizedBodyHash: provenance.normalizedBodyHash,
    }, contentVersion: "observed-body-version" });
    // This short gathered excerpt is structurally complete, but the observed read
    // was truncated. Its reviewer must see both facts instead of inferring scope.
    expect(packet.sources[0].excerpted).toBe(false);
    expect(packet.quotes[0]).toMatchObject({ prefixOmitted: false, suffixOmitted: false });
    const changedScope = structuredClone(input);
    changedScope.gathered[0].webProvenance!.truncated = false;
    const otherEngine = new ScriptedBriefEngine(candidate);
    await otherEngine.synthesize(changedScope);
    expect((otherEngine.payloads[1].packet as BriefPacket).digest).not.toBe(packet.digest);
  });
});
