/**
 * The reasoning transport's failure contract. Both invariants here come from one live incident:
 * the corpus grew to 20 sources, the decide reply stopped fitting in a flat 2048-token ceiling, and
 * a truncated JSON body parsed to nothing — which the agent read as "buy nothing". Runs kept
 * completing, sources stopped earning, and the trace looked like a deliberate frugal choice.
 *
 * So: a reply that cannot be parsed must FAIL (the resilience layer then drops a tier and the run
 * is labelled by what actually answered), and the output ceiling must grow with the corpus.
 */

import { describe, expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import type { DecideInput } from "./reasoning-engine";

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
}

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
  it("refuses to read an empty reply as a decision to buy nothing", async () => {
    // What a truncated or off-schema reply looks like after parsing.
    const engine = new StubEngine({});
    await expect(engine.decide(decideInput(20))).rejects.toThrow(/no decisions for 20 candidates/);
  });

  it("accepts a real reply and keeps the model's action and rationale", async () => {
    const engine = new StubEngine({
      decisions: [
        { sourceId: "s0", action: "BUY", expectedValue: 0.9, confidence: 0.8, rationale: "on point" },
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

  it("drops a decision naming a source that was never a candidate", async () => {
    const engine = new StubEngine({
      decisions: [{ sourceId: "ghost", action: "BUY", expectedValue: 1, confidence: 1, rationale: "" }],
    });
    // The reply was non-empty, so it is a real answer — it just does not survive validation.
    await expect(engine.decide(decideInput(2))).resolves.toEqual([]);
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
  it("parses claim-indexed exact-quote evidence for orchestrator validation", async () => {
    const engine = new StubEngine({
      answer: "USDC is burned on the source domain [S1].",
      citedMarkers: ["S1"],
      evidence: [
        {
          claimIndex: 0,
          marker: "S1",
          quote: "USDC is burned on the source domain.",
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
