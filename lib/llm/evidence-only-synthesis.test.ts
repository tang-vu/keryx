import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { EVIDENCE_CONTEXT_GUIDANCE } from "./evidence-context";
import { JsonChatEngine } from "./json-chat-engine";
import { ReasoningOutputLimitError, type SynthInput } from "./reasoning-engine";
import { evidenceOnlyEnvelope } from "./evidence-only-synthesis";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import frozenMdn from "./fixtures/issue-238-mdn-button.json";
import { gatheredArticle } from "../web-research/article-reader";
import { answerPresentation } from "../research/answer-presentation";

// Synthetic two-read/eight-target shape. These sentences test the packet, not
// SQLite documentation correctness or a live useful backup/restore run.
const facts = Array.from({ length: 8 }, (_, index) => `The synthetic backup policy requires documented safeguard ${index}.`);
const input: SynthInput = {
  question: "Compare a live WAL copy with the Backup API, including consistency, locking and restore checks.",
  subClaims: facts.map((_, index) => `What is documented safeguard ${index}?`),
  gathered: [0, 1].map(index => ({ sourceId: `policy-${index}`, sourceName: `Synthetic policy ${index}`,
    sourceKind: "public-reference" as const, itemUrl: `https://example.invalid/policy-${index}`,
    marker: `S${index + 1}`, text: facts.slice(index * 4, index * 4 + 4).join(" ") })),
  generationFormat: "evidence-only",
};

class PacketEngine extends JsonChatEngine {
  readonly name = "synthetic-evidence-packet";
  callsSeen: Array<{ system: string; packet: Record<string, unknown>; cap?: number }> = [];
  responseBytes = 0;
  constructor(private readonly failure?: "review" | "generation") { super(); }
  protected async chatJson(_model: string, system: string, user: string, cap?: number) {
    const packet = JSON.parse(user);
    this.callsSeen.push({ system, packet, cap });
    if (this.failure === "generation" && this.callsSeen.length === 1) {
      this.recordUsage({ model: "synthetic", inputTokens: 4351, cachedInputTokens: 768, outputTokens: 2560 });
      throw new ReasoningOutputLimitError(cap!);
    }
    if (this.callsSeen.length === 2) {
      if (this.failure === "review") throw new ReasoningOutputLimitError(cap!);
      return { reviews: facts.map((_, index) => ({ index, support: 0.9, statementSupport: 0.9 })) };
    }
    const options = packet.quoteOptions as Array<{ quoteId: string; marker: string; text: string }>;
    const evidence = facts.map((text, claimIndex) => {
      const option = options.find(option => option.text === text)!;
      expect(option).toBeDefined();
      return { claimIndex, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement: text };
    });
    const response = { evidence, conflicts: [] };
    this.responseBytes = Buffer.byteLength(JSON.stringify(response));
    // Deliberately unexpected draft fields cannot reach ordinary delivery.
    return { ...response, answer: "Injected unreviewed procedure [S99].", citedMarkers: ["S99"] };
  }
}

describe("ordinary evidence-only synthesis", () => {
  it("preserves shared sufficiency/private context guidance at the retained PR239 checkpoint", () => {
    // Exact evaluated constant from 1f0de603, independent of current helper output.
    expect(createHash("sha256").update(EVIDENCE_CONTEXT_GUIDANCE).digest("hex"))
      .toBe("b1f2d58bc1895e3cf2609d40ff6186494a746d53e5883a5834cd4324df966ebf");
  });

  it("combines the compact packet and requested Portuguese presentation without bypassing separate review", async () => {
    const statements = [
      "O botão submit envia os dados do formulário ao servidor.",
      "O botão reset restaura os controles para seus valores iniciais.",
      "O botão button não possui comportamento padrão.",
      "Submit é o padrão quando type está ausente, vazio ou inválido.",
    ];
    class CompactPortuguese extends JsonChatEngine {
      readonly name = "synthetic-compact-portuguese";
      packets: Array<Record<string, unknown>> = [];
      protected async chatJson(_model: string, system: string, user: string) {
        const packet = JSON.parse(user);
        this.packets.push(packet);
        if (this.packets.length === 2) {
          expect(packet.evidence).toHaveLength(4);
          return { reviews: statements.map((_, index) => ({ index, support: 0.9, statementSupport: 0.9 })) };
        }
        expect(system).toContain("write each statement in Brazilian Portuguese");
        expect(packet.schema).not.toContain('"answer"');
        const options = packet.quoteOptions as Array<{ quoteId: string; marker: string; text: string }>;
        const submit = frozenMdn.text.slice(5280, 5466);
        const quotes = [submit, "reset:", "button:", submit];
        const evidence = quotes.map((prefix, claimIndex) => {
          const option = options.find(option => claimIndex === 0 || claimIndex === 3
            ? option.text === prefix : option.text.startsWith(prefix));
          expect(option).toBeDefined();
          return { claimIndex, marker: option!.marker, quoteId: option!.quoteId,
            support: 0.9, statement: statements[claimIndex] };
        });
        return { evidence, conflicts: [], answer: "Injected draft [S99]", citedMarkers: ["S99"] };
      }
    }
    const presentation = answerPresentation(frozenMdn.question);
    const gathered = [{ ...gatheredArticle("public:web:frozen-mdn", { text: frozenMdn.text,
      title: "Frozen MDN button", finalUrl: "https://developer.mozilla.org/pt-BR/docs/Web/HTML/Reference/Elements/button",
      kind: "html", truncated: false }), marker: "S1" }];
    const engine = new CompactPortuguese();
    const result = await engine.synthesize({ question: frozenMdn.question, subClaims: frozenMdn.subClaims,
      gathered, generationFormat: "evidence-only", answerPresentation: presentation });
    expect(engine.packets).toHaveLength(2);
    const ledger = buildEvidenceLedger({ question: frozenMdn.question, subClaims: frozenMdn.subClaims, gathered,
      answer: result.answer, declaredMarkers: result.citedMarkers, proposedEvidence: result.evidence,
      finalAssessment: frozenMdn.subClaims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
    const delivered = finalizeGroundedAnswer({ question: frozenMdn.question, answer: result.answer, ledger,
      statements: selectCitedStatements(result.evidence, ledger), presentation });
    expect(delivered.match(/^- /gm)).toHaveLength(3);
    for (const statement of statements) expect(delivered).toContain(statement);
    expect(delivered).toContain("Texto da fonte");
    expect(delivered).not.toContain("Injected");
    expect(ledger.evidence.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
  });

  it("delivers eight supported targets through the unchanged two calls and 2560 generation ceiling", async () => {
    const engine = new PacketEngine();
    const result = await engine.synthesize(input);
    expect(engine.callsSeen).toHaveLength(2);
    expect(engine.callsSeen[0].cap).toBe(2560);
    expect(engine.callsSeen[0].packet.schema).not.toContain('"answer"');
    expect(engine.callsSeen[0].packet.schema).not.toContain('"citedMarkers"');
    expect(engine.responseBytes).toBeLessThan(2560); // Bytes of this fixture, not a supplier token measurement.
    expect(result.answer).toBe("[S1] [S2]");
    expect(result.citedMarkers).toEqual(["S1", "S2"]);
    const ledger = buildEvidenceLedger({ ...input, answer: result.answer, declaredMarkers: result.citedMarkers,
      proposedEvidence: result.evidence,
      finalAssessment: input.subClaims.map((claim, index) => ({ claim, coverage: 0.9, coveredBy: [index < 4 ? "S1" : "S2"] })) });
    expect(ledger.claimCoverage.every(claim => claim.coverage === 0.9)).toBe(true);
    const delivered = finalizeGroundedAnswer({ question: input.question, answer: result.answer, ledger,
      statements: selectCitedStatements(result.evidence, ledger) });
    for (const fact of facts) expect(delivered).toContain(fact);
    expect(delivered).not.toContain("Injected");
  });

  it("retains usage and the explicit ceiling on generation truncation, without review or retry", async () => {
    const engine = new PacketEngine("generation");
    await expect(engine.synthesize(input)).rejects.toMatchObject({ outputTokenLimit: 2560 });
    expect(engine.callsSeen).toHaveLength(1);
    expect(engine.usage).toMatchObject([{ outputTokens: 2560, inputTokens: 4351 }]);
  });

  it("withholds the envelope and every support after review truncation", async () => {
    const engine = new PacketEngine("review");
    const result = await engine.synthesize(input);
    expect(engine.callsSeen).toHaveLength(2);
    expect(result).toMatchObject({ answer: "", citedMarkers: [], evidenceReview: "unavailable",
      synthesisOutputLimit: { stage: "review", outputTokenLimit: 3072 } });
    expect(result.evidence.every(row => row.support === 0 && row.statementSupport === 0)).toBe(true);
  });

  it("does not manufacture markers for invalid targets, unknown reads or unresolved quotes", () => {
    const valid = { claimIndex: 0, marker: "S1", quote: facts[0], support: 0.9 };
    expect(evidenceOnlyEnvelope(input, [{ ...valid, claimIndex: 8 }, { ...valid, claimIndex: NaN },
      { ...valid, marker: "S99" }, { ...valid, quote: "" }, { ...valid, support: 0 }]))
      .toEqual({ answer: "", citedMarkers: [] });
  });

  it("does not use forged model draft markers to repair mismatched or invented quote IDs", async () => {
    class Forged extends JsonChatEngine {
      readonly name = "synthetic-forged-quotes";
      requests = 0;
      protected async chatJson(_model: string, _system: string, user: string) {
        if (++this.requests === 2) return { reviews: [{ index: 0, support: 1 }, { index: 1, support: 1 }] };
        const packet = JSON.parse(user);
        return { answer: "An invented draft [S1].", citedMarkers: ["S1"], conflicts: [], evidence: [
          { claimIndex: 0, marker: "S2", quoteId: packet.quoteOptions[0].quoteId, support: 1 },
          { claimIndex: 1, marker: "S1", quoteId: "invented", support: 1 },
        ] };
      }
    }
    const engine = new Forged();
    const result = await engine.synthesize(input);
    expect(result).toMatchObject({ answer: "", citedMarkers: [] });
    expect(result.evidence.every(row => row.quote === "")).toBe(true);
    const ledger = buildEvidenceLedger({ ...input, answer: result.answer, declaredMarkers: result.citedMarkers,
      proposedEvidence: result.evidence });
    expect(ledger.acceptedMarkers.size).toBe(0);
    // Unresolved quotes cannot construct a review packet, so no second supplier call is admitted.
    expect(engine.requests).toBe(1);
  });

  it("keeps the legacy generation schema and guidance for retained private inputs", async () => {
    const engine = new PacketEngine();
    const { generationFormat: _format, ...legacy } = input;
    const result = await engine.synthesize(legacy);
    expect(engine.callsSeen[0].packet.schema).toContain('"answer"');
    expect(engine.callsSeen[0].system).toContain("Cite inline");
    expect(result.answer).toBe("Injected unreviewed procedure [S99].");
    expect(result.citedMarkers).toEqual(["S99"]);
  });
});
