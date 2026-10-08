/**
 * The reasoning transport's failure contract. Both invariants here come from one live incident:
 * the corpus grew to 20 sources, the decide reply stopped fitting in a flat 2048-token ceiling, and
 * a truncated JSON body parsed to nothing — which the agent read as "buy nothing". Runs kept
 * completing, sources stopped earning, and the trace looked like a deliberate frugal choice.
 *
 * So: a reply that cannot be parsed must FAIL (the resilience layer then drops a tier and the run
 * is labelled by what actually answered), and the output ceiling must grow with the corpus.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonChatEngine, extractJson } from "./json-chat-engine";
import type { DecideInput, SynthInput } from "./reasoning-engine";
import { ReasoningOutputLimitError } from "./reasoning-engine";
import { ResilientEngine, reasoningAttempts } from "./resilient-engine";
import { MAX_RESEARCH_TARGETS } from "./research-target-limits";
import { ResearchSelectionError } from "./research-selection";
import { ResearchPlanningError, researchFailureMessage } from "./research-plan";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { evidenceContext } from "./evidence-context";

/** A test engine that returns whatever JSON the case wants, and records the ceiling it was given. */
class StubEngine extends JsonChatEngine {
  readonly name = "llm:test";
  lastMaxTokens?: number;
  constructor(private readonly reply: Record<string, unknown>) {
    super();
  }
  protected async chatJson(
    _model: string,
    _system: string,
    _user: string,
    maxTokens?: number,
  ): Promise<Record<string, unknown>> {
    this.lastMaxTokens = maxTokens;
    return this.reply;
  }
  /** Exposes the protected ceiling helper for direct assertions. */
  ceilingFor(items: number): number {
    return this.budgetFor(items);
  }
  guidanceFor(input: SynthInput): string { return this.synthesisGenerationGuidance(input); }
}

it("uses ordinary requested-language guidance only with explicit server opt-in", () => {
  const engine = new StubEngine({});
  const input = { question: "Explain in Portuguese", subClaims: ["Behavior"], gathered: [] };
  const historical = engine.guidanceFor(input);
  expect(historical).toContain("in the language of the question");
  expect(historical).not.toContain("For this ordinary research answer");
  expect(engine.guidanceFor({ ...input, answerPresentation: { language: "pt", requestedLanguage: "pt" } }))
    .toBe(historical.replace("Each option is already", "For this ordinary research answer, write each statement in Brazilian Portuguese. The original caller's explicit output language takes precedence over the question's language. Each option is already"));
  expect(engine.guidanceFor({ ...input, answerPresentation: { language: "en" } })).toBe(historical);
});

it("preserves valid JSON containing embedded fenced examples", () => {
  const value = { answer: "Example: ```sql CREATE INDEX i ON t(c); ```", facts: [{ text: "A literal ``` delimiter" }] };
  expect(extractJson(JSON.stringify(value))).toEqual(value);
  expect(extractJson("```json\n" + JSON.stringify(value) + "\n```")).toEqual(value);
});

it("retains an inner review output stop without relabeling successful generation or admitting unreviewed support", async () => {
  class ReviewLimitEngine extends JsonChatEngine {
    readonly name = "llm:synthetic-review";
    requests = 0;
    protected async chatJson(_model: string, _system: string, user: string) {
      if (++this.requests === 2) throw new ReasoningOutputLimitError(1280);
      const packet = JSON.parse(user);
      expect(packet.quoteOptions.length).toBeGreaterThan(0);
      return { answer: "The synthetic policy permits duplicate records [S1].", citedMarkers: ["S1"], conflicts: [],
        evidence: [{ claimIndex: 0, marker: "S1", quoteId: packet.quoteOptions[0].quoteId, support: 0.9 }] };
    }
  }
  const primary = new ReviewLimitEngine(), engine = new ResilientEngine(primary, undefined, 0, new MemoryReasoningCircuitStore());
  const result = await engine.synthesize({ question: "Does the synthetic policy permit duplicates?", subClaims: ["Are duplicates permitted?"],
    gathered: [{ sourceId: "one", sourceName: "Synthetic policy", marker: "S1", text: "The synthetic policy permits duplicate records. Handlers must tolerate duplicate records." }] });
  expect(primary.requests).toBe(2);
  expect(result.evidenceReview).toBe("unavailable");
  expect(result.synthesisOutputLimit).toEqual({ stage: "review", outputTokenLimit: 1280 });
  expect(result.evidence.every(item => item.support === 0)).toBe(true);
  expect(reasoningAttempts(engine)).toMatchObject([{ step: "synthesize", outcome: "served" }]);
  expect(reasoningAttempts(engine)[0].error).toBeUndefined();
});

describe("bounded independent research targets", () => {
  it("preserves all six requested paper-by-dimension targets and exact versions", async () => {
    const ids = ["2606.02668v1", "2607.13716v1"];
    const dimensions = ["methods", "evaluation setup", "limitations"];
    const claims = ids.flatMap(id => dimensions.map(dimension => `What ${dimension} are described in arXiv:${id}?`));
    const engine = new StubEngine({ constraints: ["Cite exact versions"], claims });
    const result = await engine.decompose("Compare the methods, evaluation setup and limitations of arXiv:2606.02668v1 and arXiv:2607.13716v1.");
    expect(result).toEqual(claims);
    expect(result).toHaveLength(6);
    expect(result.filter(claim => claim.includes("limitations"))).toHaveLength(2);
  });

  it("requests independently inspectable source-specific dimensions in the planning prompt", async () => {
    let system = "";
    class CaptureEngine extends JsonChatEngine {
      readonly name = "capture";
      protected async chatJson(_model: string, prompt: string) { system = prompt; return { claims: ["What methods?"] }; }
    }
    await new CaptureEngine().decompose("Compare two papers");
    expect(system).toContain(`1-${MAX_RESEARCH_TARGETS}`);
    expect(system).toContain("six targets");
    expect(system).toContain("evidence from only one paper");
  });

  it("refuses excessive model targets rather than silently deleting a requested dimension", async () => {
    const claims = Array.from({ length: MAX_RESEARCH_TARGETS + 1 }, (_, index) => `What is distinct target ${index}?`);
    await expect(new StubEngine({ claims }).decompose("An oversized comparison")).rejects.toThrow(/exceeded 8 targets/);
  });
});

describe("open comparison planning through synthetic transport", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function provider(name = "primary") {
    // These cases test synthetic response contracts; retained local canary state is separate.
    class SyntheticTransport extends OpenAICompatibleEngine {
      protected assertSupplierAdmission(): void {}
    }
    return new SyntheticTransport({ name: `llm:open-comparison-${name}`,
      baseUrl: `https://${name}.synthetic.invalid`, apiKey: "synthetic", model: "synthetic" });
  }
  function response(output: Record<string, unknown>) {
    return Response.json({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 23, completion_tokens: 11 } });
  }

  it("keeps a bounded provisional shortlist atomic and sends every dimension to selection", async () => {
    // Synthetic candidate names and dimensions, not known systems, findings or historical model output.
    const subjects = ["Candidate A", "Candidate B"];
    const dimensions = ["API write support", "authorization safeguards", "limitations"];
    const claims = subjects.flatMap(subject => dimensions.map(dimension => `What ${dimension} does ${subject} have?`));
    const transport = vi.fn()
      .mockResolvedValueOnce(response({ status: "complete", constraints: ["A provisional shortlist; verify eligibility from originals"], claims }))
      .mockResolvedValueOnce(response({ decisions: [
        { sourceId: "s0", action: "CACHE", expectedValue: 0.7, confidence: 0.5, rationale: "Unobserved original may address Candidate A", targets: [0, 1, 2] },
        { sourceId: "s1", action: "CACHE", expectedValue: 0.7, confidence: 0.5, rationale: "Unobserved original may address Candidate B", targets: [3, 4, 5] },
      ] }));
    vi.stubGlobal("fetch", transport);
    const engine = provider();
    const question = "Suggest a provisional shortlist of two systems, checking each one's API write support, authorization safeguards and limitations.";
    const subClaims = await engine.decompose(question);
    expect(subClaims).toEqual(claims);
    const input = decideInput(2);
    input.question = question; input.subClaims = subClaims;
    input.candidates.forEach(candidate => { candidate.sourceKind = "public-reference"; candidate.fetchPrice = 0; });
    expect(await engine.decide(input)).toMatchObject([{ sourceId: "s0", targets: [0, 1, 2] }, { sourceId: "s1", targets: [3, 4, 5] }]);
    expect(transport).toHaveBeenCalledTimes(2);
    const planningWire = JSON.parse(transport.mock.calls[0][1].body as string);
    expect(planningWire.messages[1].content).toContain(JSON.stringify(question));
    expect(planningWire.messages[0].content).toContain("provisional discovery hypotheses");
    expect(planningWire.messages[0].content).toContain("never put every criterion into one candidate target");
    expect(planningWire.messages[0].content).toContain("Six candidates on those three dimensions require eighteen targets");
    const selectionWire = JSON.parse(transport.mock.calls[1][1].body as string);
    const payload = JSON.parse(selectionWire.messages[1].content);
    expect(payload.subClaims).toEqual(claims.map((question, claimIndex) => ({ claimIndex, question })));
    expect(payload.allowedTargetIndexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(engine.selectionDiagnostics).toEqual([]);
    expect(engine.calls).toHaveLength(2);
  });

  it.each(["needs_refinement", "expanded_output"] as const)(
    "refuses broad candidate-by-dimension scope as %s without another attempt or lost usage", async reason => {
      const subjects = Array.from({ length: 6 }, (_, index) => `Candidate ${index}`);
      const claims = subjects.flatMap(subject => ["API write support", "authorization safeguards", "limitations"]
        .map(dimension => `What ${dimension} does ${subject} have?`));
      const transport = vi.fn().mockResolvedValue(response({ status: reason === "needs_refinement" ? "needs_refinement" : "complete", claims }));
      vi.stubGlobal("fetch", transport);
      const primary = provider(), fallback = provider("fallback"), store = new MemoryReasoningCircuitStore();
      const failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
      const engine = new ResilientEngine(primary, fallback, 0, store);
      const question = "Compare six candidate systems on API write support, authorization safeguards and limitations; preserve every dimension and original source qualification.";
      const error = await engine.decompose(question).then(() => { throw new Error("Expected bounded refusal"); }, value => value);
      expect(error).toBeInstanceOf(ResearchPlanningError);
      expect(error).toMatchObject({ reason, status: 422, maximumTargets: 8 });
      expect(error.scopeChoices.length).toBeGreaterThan(0);
      expect(error.scopeChoices.length).toBeLessThanOrEqual(3);
      expect(researchFailureMessage(error)).toContain("not a new question or an automatic retry");
      expect(JSON.stringify(error)).not.toContain("Compare six candidate systems");
      expect(transport).toHaveBeenCalledOnce(); expect(fallback.calls).toEqual([]);
      expect(primary.calls).toMatchObject([{ outcome: "returned" }]);
      expect(primary.usage).toMatchObject([{ inputTokens: 23, outputTokens: 11 }]);
      expect(reasoningAttempts(engine)).toMatchObject([{ step: "decompose", outcome: "failed", error: "output_validation", status: 422 }]);
      expect(reasoningAttempts(engine)).toHaveLength(1);
      expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
      expect(engine.selectionDiagnostics).toEqual([]);
    },
  );

  it("preserves the exact eight-target ceiling without an extra category-coverage target", async () => {
    const claims = ["Candidate A", "Candidate B"].flatMap(subject =>
      ["API write support", "authorization safeguards", "transaction behavior", "limitations"]
        .map(dimension => `What ${dimension} does ${subject} have?`));
    const transport = vi.fn().mockResolvedValue(response({ status: "complete", claims }));
    vi.stubGlobal("fetch", transport);
    const engine = provider();
    expect(await engine.decompose("Compare two provisional candidates on API write support, authorization safeguards, transaction behavior and limitations."))
      .toEqual(claims);
    expect(claims).toHaveLength(MAX_RESEARCH_TARGETS);
    const prompt = JSON.parse(transport.mock.calls[0][1].body as string).messages[0].content;
    expect(prompt).toContain("without silently narrowing the user's requested scope");
    expect(prompt).toContain("naming candidates alone never establishes completeness");
    expect(prompt).toContain("Do not add an umbrella target for 'other candidates'");
    expect(prompt).not.toContain("one target per candidate");
    expect(transport).toHaveBeenCalledOnce();
  });
});

function decideInput(candidateCount: number): DecideInput {
  return {
    question: "why do sub-cent tolls matter?",
    subClaims: ["a"],
    budget: 0.05,
    spentSoFar: 0,
    candidates: Array.from({ length: candidateCount }, (_, i) => ({
      id: `s${i}`,
      name: `Source ${i}`,
      description: "d",
      tags: [],
      fetchPrice: 0.002,
      cached: false,
      preview: "p",
    })),
  } as unknown as DecideInput;
}

describe("decide", () => {
  it("instructs discovery-only SKIP even for advertised Arc-compatible external candidates", async () => {
    let system = "", user = "";
    class CaptureEngine extends JsonChatEngine {
      readonly name = "capture";
      protected async chatJson(_model: string, prompt: string, payload: string) {
        system = prompt; user = payload;
        return { decisions: [{ sourceId: "ext:https://paid.example/api", action: "SKIP", expectedValue: 0.9,
          confidence: 1, rationale: "discovery-only", targets: [] }] };
      }
    }
    const input = decideInput(1);
    input.candidates[0].id = "ext:https://paid.example/api";
    input.candidates[0].external = { resource: "https://paid.example/api", chains: ["Arc mainnet"],
      payTo: "0xadvertised", onArc: true };
    const decisions = await new CaptureEngine().decide(input);
    expect(decisions).toMatchObject([{ action: "SKIP", targets: [] }]);
    expect(JSON.parse(user).candidates[0]).toMatchObject({ external: true, settlesOnArc: true });
    expect(system).toContain("regardless of their advertised payment networks");
    expect(system).toContain("Mark them SKIP");
    expect(system).toContain("not trusted payment authority or settlement evidence");
    expect(system).not.toMatch(/OTHER chains|off-rail chain/);
  });

  it("refuses to read an empty reply as a decision to buy nothing", async () => {
    // What a truncated or off-schema reply looks like after parsing.
    const engine = new StubEngine({});
    await expect(engine.decide(decideInput(20))).rejects.toBeInstanceOf(ResearchSelectionError);
    expect(engine.selectionDiagnostics[0]).toMatchObject({ counts: { candidateCount: 20 }, reasons: [{ code: "no_decisions" }] });
  });

  it("accepts a real reply and keeps the model's action and rationale", async () => {
    const engine = new StubEngine({
      decisions: [
        { sourceId: "s0", action: "BUY", expectedValue: 0.9, confidence: 0.8, rationale: "on point", targets: [0] },
      ],
    });
    const out = await engine.decide(decideInput(2));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourceId: "s0", action: "BUY", rationale: "on point" });
  });

  it("says nothing is worth buying only when nothing was offered", async () => {
    const engine = new StubEngine({});
    await expect(engine.decide(decideInput(0))).resolves.toEqual([]);
  });

  it.each([undefined, [], ["0"], [-1], [1], [0.5], [0, 99]])(
    "rejects actionable decisions with invalid targets %j before spend", async (targets) => {
      for (const action of ["BUY", "CACHE"]) {
        const engine = new StubEngine({ decisions: [{ sourceId: "s0", action, expectedValue: 0.9, confidence: 0.8, rationale: "relevant", targets }] });
        await expect(engine.decide(decideInput(1))).rejects.toBeInstanceOf(ResearchSelectionError);
      }
    },
  );

  it("preserves an intentional SKIP with no evidence target", async () => {
    const engine = new StubEngine({ decisions: [{ sourceId: "s0", action: "SKIP", expectedValue: 0, confidence: 1, rationale: "unrelated", targets: [] }] });
    expect(await engine.decide(decideInput(1))).toMatchObject([{ action: "SKIP", targets: [] }]);
  });

  it("refuses missing target links without calling another paid tier", async () => {
    const primary = new StubEngine({ decisions: [{ sourceId: "s0", action: "BUY", expectedValue: 1, confidence: 1, rationale: "relevant" }] });
    const fallback = new StubEngine({ decisions: [{ sourceId: "s0", action: "BUY", expectedValue: 1, confidence: 1, rationale: "supports target 0", targets: [0] }] });
    const engine = new ResilientEngine(primary, fallback);
    await expect(engine.decide(decideInput(1))).rejects.toBeInstanceOf(ResearchSelectionError);
    expect(fallback.calls).toHaveLength(0);
    expect(reasoningAttempts(engine)).toEqual([
      expect.objectContaining({ step: "decide", outcome: "failed", error: "output_validation", status: 422, tier: 0 }),
    ]);
  });

  it("refuses a selection naming no caller-owned candidate", async () => {
    const engine = new StubEngine({
      decisions: [{ sourceId: "ghost", action: "BUY", expectedValue: 1, confidence: 1, rationale: "" }],
    });
    await expect(engine.decide(decideInput(2))).rejects.toBeInstanceOf(ResearchSelectionError);
    expect(engine.selectionDiagnostics[0].reasons).toEqual([
      { code: "unknown_source", rowIndex: 0 }, { code: "no_matched_decisions" },
    ]);
  });

  it("asks for an output ceiling that grows with the candidate list", async () => {
    const engine = new StubEngine({
      decisions: [{ sourceId: "s0", action: "SKIP", expectedValue: 0, confidence: 1, rationale: "" }],
    });
    await engine.decide(decideInput(2));
    const small = engine.lastMaxTokens!;
    await engine.decide(decideInput(20));
    expect(engine.lastMaxTokens!).toBeGreaterThan(small);
  });
});

describe("output ceiling", () => {
  const engine = new StubEngine({});

  it("keeps a floor for the fixed parts of a reply", () => {
    expect(engine.ceilingFor(0)).toBeGreaterThanOrEqual(1024);
  });

  it("would have cleared the 20-source reply that a flat 2048 truncated", () => {
    expect(engine.ceilingFor(20)).toBeGreaterThan(2048);
  });

  it("stays inside provider limits however large the corpus grows", () => {
    expect(engine.ceilingFor(10_000)).toBeLessThanOrEqual(8192);
  });
});

describe("synthesis evidence contract", () => {
  it("keeps the ordinary sampled context identical in sufficiency and synthesis", async () => {
    const prompts: Array<Record<string, unknown>> = [];
    class Capture extends JsonChatEngine {
      readonly name = "offline-context-contract";
      protected async chatJson(_model: string, _system: string, user: string) {
        prompts.push(JSON.parse(user)); return {};
      }
    }
    const input = { question: "What constraints apply to this synthetic mechanism?", subClaims: ["Which constraints apply?"],
      gathered: [{ sourceId: "synthetic-source", sourceName: "Synthetic bounded reference", marker: "S1",
        text: Array.from({ length: 45 }, (_, index) => `Section ${index} records the synthetic mechanism and its constraint details.`).join("\n") }] };
    const expected = evidenceContext(input.question, input.subClaims, input.gathered);
    const engine = new Capture();
    await engine.sufficiency(input);
    await engine.synthesize(input);
    expect(prompts[0].gathered).toEqual(expected);
    expect(prompts[1].sources).toEqual(expected);
    expect(expected[0].excerpted).toBe(true);
    expect(expected[0].passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThan(input.gathered[0].text.length);
  });

  it("parses claim-indexed exact-quote evidence for orchestrator validation", async () => {
    const engine = new StubEngine({
      answer: "USDC is burned on the source domain [S1].",
      reviews: [{ index: 0, support: 0.9 }],
      citedMarkers: ["S1"],
      evidence: [
        {
          claimIndex: 0,
          marker: "S1",
          quoteId: "q0_0",
          support: 0.87,
        },
      ],
      conflicts: [],
    });

    const result = await engine.synthesize({
      question: "How does CCTP work?",
      subClaims: ["CCTP burns USDC on the source domain."],
      gathered: [
        {
          sourceId: "source-1",
          sourceName: "Circle docs",
          marker: "S1",
          text: "USDC is burned on the source domain.",
        },
      ],
    });

    expect(result.evidence).toEqual([
      {
        claimIndex: 0,
        marker: "S1",
        quote: "USDC is burned on the source domain.",
        quoteSpan: { start: 0, end: "USDC is burned on the source domain.".length },
        support: 0.87,
      },
    ]);
  });
});

describe("final sufficiency contract", () => {
  it("keeps caller-owned claim identity when the model paraphrases it", async () => {
    const engine = new StubEngine({
      sufficient: true,
      rationale: "covered",
      perClaim: [
        {
          claim: "model paraphrase",
          coverage: 0.8,
          coveredBy: ["S1"],
        },
      ],
    });

    const result = await engine.sufficiency({
      question: "How does CCTP work?",
      subClaims: ["CCTP burns USDC on the source domain."],
      gathered: [
        {
          sourceId: "source-1",
          sourceName: "Circle docs",
          marker: "S1",
          text: "USDC is burned on the source domain.",
        },
      ],
    });

    expect(result.perClaim).toEqual([
      {
        claim: "CCTP burns USDC on the source domain.",
        coverage: 0.8,
        coveredBy: ["S1"],
      },
    ]);
  });
});


it("retains a reported disagreement when the model omits a preferred source", async () => {
  const engine = new StubEngine({ answer: "The sources conflict.", citedMarkers: [], evidence: [],
    conflicts: [{ point: "retention", positions: [{ marker: "S1", stance: "seven" }, { marker: "S2", stance: "thirty" }], reason: "No precedence rule" }] });
  const result = await engine.synthesize({ question: "Which policy applies?", subClaims: ["Which policy applies?"], gathered: [] });
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0].trusted).toBe("none");
});
