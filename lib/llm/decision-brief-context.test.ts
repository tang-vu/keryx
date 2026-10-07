import { describe, expect, it } from "vitest";
import { briefContextSources, MAX_BRIEF_CONTEXT_CHARACTERS, type BriefPacket } from "./decision-brief";
import { evidenceContext } from "./evidence-context";
import { JsonChatEngine } from "./json-chat-engine";
import { buildContextualQuoteOptions } from "./quote-context";
import type { SynthInput } from "./reasoning-engine";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { deliverDecisionBrief } from "../agent/decision-brief";

/** Invented independent subjects: this checks bounded delivery, not live model accuracy. */
function channelResearch(): SynthInput {
  const subClaims = Array.from({ length: 8 }, (_, index) => `What behavior is documented for Channel${index}?`);
  return { question: "Describe the documented behavior of the eight internal channels.", subClaims,
    answerFormat: "decision-brief", gathered: subClaims.map((_, index) => ({
      sourceId: `internal-channel-${index}`, sourceName: `Internal channel ${index}`, marker: `S${index + 1}`,
      contentVersion: `fixture-version-${index}`, sourceKind: "public-reference",
      text: "An internal background note.\n" + "Unrelated appendix line.\n".repeat(100) +
        `Channel${index} permits duplicate delivery.\n` + "This does not guarantee successful processing.\n" +
        "Unrelated appendix line.\n".repeat(100),
    })) };
}

class ContextFixtureEngine extends JsonChatEngine {
  readonly name = "offline-context-fixture";
  protected supportsDecisionBrief() { return true; }
  constructor(private readonly selectAllNeighborhoods = false) { super(); }
  readonly requests: { system: string; data: Record<string, unknown>; maxTokens?: number }[] = [];
  protected async chatJson(_model: string, system: string, user: string, maxTokens?: number) {
    const data = JSON.parse(user);
    this.requests.push({ system, data, maxTokens });
    if (!data.packet) {
      const quotes = data.quoteOptions as { quoteId: string; text: string; marker: string }[];
      if (this.selectAllNeighborhoods) return { facts: quotes.map((quote, index) => ({
        id: `f${index + 1}`, targetIndex: Number(quote.marker.slice(1)) - 1, text: quote.text,
        quoteIds: [quote.quoteId], support: 0.8,
      })), actions: [] };
      return { facts: Array.from({ length: 8 }, (_, index) => ({ id: `f${index + 1}`, targetIndex: index,
        text: `Channel${index} permits duplicate delivery.`,
        quoteIds: [quotes.find(quote => quote.text === `Channel${index} permits duplicate delivery.`)!.quoteId], support: 0.8 })), actions: [] };
    }
    const packet = data.packet as BriefPacket;
    return { format: "compact-v1", digest: packet.digest,
      facts: packet.candidate.facts.map(fact => [fact.id, "supported", 0.7,
        fact.quoteIds.map(id => [id, "supported", 0.7])]), actions: [] };
  }
}

describe("selected-quote decision brief context admission", () => {
  it("delivers eight distinct substantive targets when unused quote neighborhoods exceed the unchanged aggregate bound", async () => {
    const input = channelResearch();
    const selected = evidenceContext(input.question, input.subClaims, input.gathered);
    const menu = buildContextualQuoteOptions(selected, input.gathered);
    // Reproduce the old premature exit from expanding every alternative.
    expect(() => briefContextSources(selected, input, menu)).toThrow("contextual input bound exceeded");
    const engine = new ContextFixtureEngine();
    const result = await engine.synthesize(input);
    expect(engine.requests).toHaveLength(2);
    expect(engine.requests.map(request => request.maxTokens)).toEqual([4096, 4096]);
    const generatedSources = engine.requests[0].data.sources as BriefPacket["sources"];
    const packet = engine.requests[1].data.packet as BriefPacket;
    expect(generatedSources.map(source => source.passages)).toEqual(selected.map(source => source.passages));
    expect(packet.sources.map(source => source.passages)).toEqual(selected.map(source => source.passages));
    expect(packet.sources).toHaveLength(8);
    expect(packet.targets).toEqual(input.subClaims);
    expect(packet.quotes).toHaveLength(8);
    expect(packet.sources.reduce((sum, source) => sum + source.quoteContexts!.reduce((n, span) => n + span.text.length, 0), 0))
      .toBeLessThanOrEqual(MAX_BRIEF_CONTEXT_CHARACTERS);
    for (const [index, source] of packet.sources.entries()) {
      expect(source.contentVersion).toBe(`fixture-version-${index}`);
      expect(source.quoteContexts![0].text).toContain("does not guarantee successful processing");
    }
    const ledger = buildEvidenceLedger({ question: input.question, subClaims: input.subClaims, gathered: input.gathered,
      answer: result.answer, declaredMarkers: result.citedMarkers, proposedEvidence: result.evidence,
      finalAssessment: input.subClaims.map((claim, index) => ({ claim, coverage: 0.8, coveredBy: [`S${index + 1}`] })) });
    const delivered = deliverDecisionBrief(result.decisionBrief, ledger, input.question)!;
    expect(delivered.facts).toBe(8);
    for (let index = 0; index < 8; index++) {
      expect(delivered.answer).toContain(`Channel${index} permits duplicate delivery.`);
      expect(delivered.answer).toContain(`[S${index + 1}]`);
    }
    expect(delivered.answer).not.toContain("Insufficient evidence for this target");
    expect(delivered.ledger.evidence.every(evidence => !evidence.qualifiesForReward)).toBe(true);
  });

  it("counts all selected adverse passages and refuses an oversized base corpus before any model dispatch", async () => {
    const input = channelResearch();
    input.gathered = input.gathered.map((source, index) => ({ ...source,
      text: `Channel${index} documented behavior. ` + "A distinct retained limitation applies. ".repeat(45) }));
    const selected = evidenceContext(input.question, input.subClaims, input.gathered);
    expect(selected.reduce((sum, source) => sum + source.passages.reduce((n, span) => n + span.text.length, 0), 0))
      .toBeGreaterThan(MAX_BRIEF_CONTEXT_CHARACTERS);
    const engine = new ContextFixtureEngine();
    const result = await engine.synthesize(input);
    expect(engine.requests).toHaveLength(0);
    expect(result).toMatchObject({ answer: "", evidence: [], evidenceReview: "unavailable" });
    expect(result.synthesisFailure).toBe("input");
  });

  it("refuses actual selected-neighborhood overflow after one generation without trimming or retrying", async () => {
    const engine = new ContextFixtureEngine(true);
    const result = await engine.synthesize(channelResearch());
    expect(engine.requests).toHaveLength(1);
    expect(result).toMatchObject({ answer: "", evidence: [], evidenceReview: "unavailable" });
    expect(result.synthesisFailure).toBe("input");
    expect(result.decisionBrief).toBeUndefined();
  });

  it("adds an omitted neighboring qualification to review and rejects the overgeneralized draft", async () => {
    const padding = "Unrelated background.\n".repeat(100);
    const text = `An internal background note.\n${padding}ChannelX permits automatic delivery.\n` +
      `However, that policy excludes retained retry events.\n${padding}`;
    const input: SynthInput = { question: "Is ChannelX automatic delivery guaranteed?",
      subClaims: ["Is ChannelX automatic delivery guaranteed?"], answerFormat: "decision-brief",
      gathered: [{ sourceId: "channel-x", sourceName: "Internal channel X", marker: "S1", text }] };
    class CaveatEngine extends JsonChatEngine {
      readonly name = "offline-caveat-fixture";
      protected supportsDecisionBrief() { return true; }
      callsMade = 0;
      protected async chatJson(_model: string, _system: string, user: string) {
        this.callsMade++;
        const data = JSON.parse(user);
        if (!data.packet) {
          expect(data.sources[0].passages.every((span: { text: string }) => !span.text.includes("excludes retained retry events"))).toBe(true);
          const quote = data.quoteOptions.find((option: { text: string }) => option.text === "ChannelX permits automatic delivery.");
          return { facts: [{ id: "f1", targetIndex: 0, text: "ChannelX guarantees automatic delivery.",
            quoteIds: [quote.quoteId], support: 0.9 }], actions: [] };
        }
        const packet = data.packet as BriefPacket;
        expect(packet.sources[0].quoteContexts!.some(span => span.text.includes("excludes retained retry events"))).toBe(true);
        return { format: "compact-v1", digest: packet.digest,
          facts: [["f1", "unsupported", 0, [[packet.quotes[0].quoteId, "unsupported", 0]]]], actions: [] };
      }
    }
    const engine = new CaveatEngine();
    const result = await engine.synthesize(input);
    expect(engine.callsMade).toBe(2);
    expect(result.answer).toBe("");
    expect(result.evidence).toEqual([]);
    expect(result.decisionBrief?.facts).toEqual([]);
  });

  it("preserves selected material with no selected quote and counts overlap only at identical source offsets", () => {
    const input = channelResearch();
    const selected = evidenceContext(input.question, input.subClaims, input.gathered);
    const options = buildContextualQuoteOptions(selected, input.gathered).filter(quote => quote.marker === "S1" && quote.text.includes("Channel0"));
    const sources = briefContextSources(selected, input, options);
    expect(sources.map(source => source.passages)).toEqual(selected.map(source => source.passages));
    expect(sources[1].quoteContexts).toEqual([]);
    const repeated = briefContextSources(selected, input, [...options, ...options]);
    expect(repeated).toEqual(sources);
  });
});
