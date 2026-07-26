/**
 * The judged feed check. What must never break: a verdict is only ever reported as the agent's when
 * a model actually produced it, a skip never hands back an opportunity list, a hallucinated claim
 * index never puts someone else's claim in front of a writer, and a provider outage degrades the
 * answer instead of removing it.
 */

import { describe, expect, it } from "vitest";
import { judgeFeedAgainstGaps } from "./demand-match-judge";
import { ResilientEngine } from "./llm/resilient-engine";
import type { DemandGap } from "./demand-signal";
import type { FeedPost } from "./demand-match";
import type { DecideInput, ReasoningEngine } from "./llm/reasoning-engine";
import type { Decision } from "./types";

const CLAIM = "CCTP uses a burn-and-mint mechanism to transfer USDC between domains.";
const OTHER = "Gateway settles sub-cent USDC payments without an on-chain transaction each time.";

function gap(claim: string): DemandGap {
  return {
    claim,
    coverage: 0.1,
    queryId: "q1",
    question: "How does CCTP move USDC?",
    createdAt: "2026-07-20T00:00:00.000Z",
    seen: 2,
  };
}

const POSTS: FeedPost[] = [
  { title: "How CCTP burns and mints USDC across domains", summary: "A walk through.", link: "https://b.example/1" },
  { title: "Gardening in July", summary: "Tomatoes.", link: "https://b.example/2" },
];

/** An engine whose `decide` returns a fixed verdict; every other method is unreachable here. */
function engineDeciding(
  decision: Partial<Decision> | null,
  capture?: (input: DecideInput) => void,
): ReasoningEngine {
  return {
    name: "llm:test",
    decompose: async () => [],
    decide: async (input) => {
      capture?.(input);
      if (!decision) return [];
      return [
        {
          sourceId: "candidate-feed",
          sourceName: "feed",
          action: "BUY",
          expectedValue: 0.7,
          price: 0.002,
          confidence: 0.6,
          rationale: "covers it",
          targets: [],
          ...decision,
        } as Decision,
      ];
    },
    sufficiency: async () => ({ sufficient: false, rationale: "" }),
    reevaluate: async () => ({ claims: [], shouldBuyMore: false, recommendedIds: [], rationale: "" }),
    synthesize: async () => ({ answer: "", citedMarkers: [], conflicts: [] }),
    attribute: async () => [],
  };
}

function throwingEngine(): ReasoningEngine {
  const e = engineDeciding(null);
  return { ...e, decide: async () => { throw new Error("provider down"); } };
}

describe("judgeFeedAgainstGaps", () => {
  it("reports a BUY with the agent's own rationale and the claims it named", async () => {
    const engine = engineDeciding({ action: "BUY", targets: [1], rationale: "two posts on CCTP" });
    const verdict = await judgeFeedAgainstGaps([gap(OTHER), gap(CLAIM)], POSTS, engine);

    expect(verdict.judged).toBe("model");
    expect(verdict.wouldBuy).toBe(true);
    expect(verdict.rationale).toBe("two posts on CCTP");
    expect(verdict.matches.map((m) => m.gap.claim)).toEqual([CLAIM]);
  });

  it("a SKIP hands back no opportunities — the agent just said it would not pay", async () => {
    const engine = engineDeciding({ action: "SKIP", targets: [0], rationale: "off topic" });
    const verdict = await judgeFeedAgainstGaps([gap(CLAIM)], POSTS, engine);

    expect(verdict.wouldBuy).toBe(false);
    expect(verdict.matches).toEqual([]);
    expect(verdict.rationale).toBe("off topic");
  });

  it("drops claim indexes the reply invented", async () => {
    const engine = engineDeciding({ targets: [0, 9, -1, 1.5] });
    const verdict = await judgeFeedAgainstGaps([gap(CLAIM)], POSTS, engine);

    expect(verdict.matches.map((m) => m.gap.claim)).toEqual([CLAIM]);
  });

  it("keeps a BUY with no usable targets, rather than inventing one", async () => {
    const verdict = await judgeFeedAgainstGaps([gap(CLAIM)], POSTS, engineDeciding({ targets: [] }));

    expect(verdict.wouldBuy).toBe(true);
    expect(verdict.matches).toEqual([]);
  });

  it("drops a target list so broad it names nothing", async () => {
    // Offered 40 real claims, production came back naming 36 of them. That is "broadly relevant",
    // and printing it as a shortlist would send a writer off to work on all of it.
    const board = Array.from({ length: 10 }, (_, i) => gap(`claim number ${i} about payments`));
    const engine = engineDeciding({ targets: [0, 1, 2, 3, 4, 5, 6, 7] });
    const verdict = await judgeFeedAgainstGaps(board, POSTS, engine);

    expect(verdict.wouldBuy).toBe(true);
    expect(verdict.matches).toEqual([]);
  });

  it("shows a specific list in board order, capped", async () => {
    const board = Array.from({ length: 40 }, (_, i) => gap(`claim number ${i} about payments`));
    const engine = engineDeciding({ targets: [12, 3, 0, 19, 7, 5, 2, 9, 15, 1] });
    const verdict = await judgeFeedAgainstGaps(board, POSTS, engine);

    expect(verdict.matches).toHaveLength(8);
    expect(verdict.matches[0].gap.claim).toBe("claim number 0 about payments");
    expect(verdict.matches[1].gap.claim).toBe("claim number 1 about payments");
  });

  it("shows the agent the feed the way discovery shows it a listed source", async () => {
    let seen: DecideInput | undefined;
    await judgeFeedAgainstGaps([gap(CLAIM)], POSTS, engineDeciding({}, (i) => (seen = i)), {
      title: "My Blog",
      description: "Notes on cross-chain settlement",
    });

    expect(seen!.candidates).toHaveLength(1);
    expect(seen!.candidates[0].name).toBe("My Blog");
    expect(seen!.candidates[0].cached).toBe(false);
    // The feed's own blurb, not a label this check made up about it being unlisted.
    expect(seen!.candidates[0].description).toBe("Notes on cross-chain settlement");
    expect(seen!.candidates[0].preview).toContain("- How CCTP burns and mints USDC across domains: A walk through.");
  });

  it("falls back to word overlap when the provider is down, and labels it as such", async () => {
    const verdict = await judgeFeedAgainstGaps([gap(CLAIM)], POSTS, throwingEngine());

    expect(verdict.judged).toBe("words");
    expect(verdict.wouldBuy).toBe(false); // a guess is never reported as a decision to pay
    expect(verdict.matches[0]?.shared.length).toBeGreaterThan(0);
    expect(verdict.matches[0]?.post?.title).toContain("CCTP");
  });

  it("never reports the deterministic heuristic's verdict as the agent's", async () => {
    // A ResilientEngine whose primary fails serves the step from the heuristic, whose decisions are
    // word overlap; passing that off as a model decision would misdescribe how it was reached.
    const verdict = await judgeFeedAgainstGaps([gap(CLAIM)], POSTS, new ResilientEngine(throwingEngine()));

    expect(verdict.judged).toBe("words");
  });

  it("returns the word path for an empty board or an empty feed", async () => {
    const engine = engineDeciding({ targets: [0] });
    expect((await judgeFeedAgainstGaps([], POSTS, engine)).judged).toBe("words");
    expect((await judgeFeedAgainstGaps([gap(CLAIM)], [], engine)).matches).toEqual([]);
  });
});
