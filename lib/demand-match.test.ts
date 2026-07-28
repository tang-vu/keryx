/**
 * Feed → demand board matching. What must never break: a match names a real post, one post has to
 * carry the claim on its own, and a coincidence of one shared word is never offered as an
 * opportunity someone should do work on.
 */

import { describe, expect, it } from "vitest";
import { matchFeedToGaps, type FeedPost } from "./demand-match";
import { demandGapId, type DemandGap } from "./demand-signal";

function gap(claim: string, over: Partial<DemandGap> = {}): DemandGap {
  return {
    id: over.id ?? demandGapId(claim),
    claim,
    coverage: 0.1,
    queryId: "q1",
    question: "How does CCTP move USDC?",
    createdAt: "2026-07-20T00:00:00.000Z",
    seen: 1,
    ...over,
  };
}

function post(title: string, summary = ""): FeedPost {
  return { title, summary, link: `https://blog.example/${title.slice(0, 8)}` };
}

const CCTP = gap("CCTP uses a burn-and-mint mechanism to transfer USDC between domains.");

describe("matchFeedToGaps", () => {
  it("matches a post that covers the claim's vocabulary, and names it", () => {
    const posts = [post("Unrelated notes on gardening"), post("How CCTP burns and mints USDC across domains")];
    const [match] = matchFeedToGaps([CCTP], posts);

    expect(match.post.title).toContain("CCTP");
    expect(match.score).toBeGreaterThanOrEqual(0.5);
    expect(match.shared).toContain("cctp");
  });

  it("reads the summary too — the rest of what a free preview shows", () => {
    const posts = [post("Field notes", "A walk through burn and mint: how CCTP moves USDC between domains.")];
    expect(matchFeedToGaps([CCTP], posts)).toHaveLength(1);
  });

  it("never matches on the paid body, which the agent cannot see when it decides", () => {
    const posts: FeedPost[] = [
      { title: "Field notes", summary: "Short one today.", link: "https://blog.example/x" },
    ];
    expect(matchFeedToGaps([CCTP], posts)).toHaveLength(0);
  });

  it("one shared word is a coincidence, not a subject", () => {
    // "usdc" alone overlaps with half the corpus; it must not put a claim in front of a writer.
    expect(matchFeedToGaps([CCTP], [post("USDC is a stablecoin")])).toHaveLength(0);
  });

  it("requires ONE post to carry the claim, not the feed's combined vocabulary", () => {
    const spread = [post("What burn and mint means"), post("Domains, explained"), post("CCTP at a glance")];
    // Between them these cover the claim; individually none does, so nothing is claimed.
    expect(matchFeedToGaps([CCTP], spread)).toHaveLength(0);
  });

  it("keeps the best-matching post per claim, never one row per post", () => {
    const posts = [
      post("CCTP burns USDC", "Between domains."),
      post("CCTP burn-and-mint mechanism transfers USDC between domains, in full"),
    ];
    const matches = matchFeedToGaps([CCTP], posts);

    expect(matches).toHaveLength(1);
    expect(matches[0].post.title).toContain("in full");
  });

  it("ranks by match strength, then by how often the hole recurred", () => {
    const weak = gap("Gateway settles sub-cent USDC payments off-chain.", { seen: 9 });
    const posts = [
      post("How CCTP burns and mints USDC across domains"),
      post("Gateway settles USDC payments, sub-cent, off-chain, in depth"),
    ];
    const matches = matchFeedToGaps([CCTP, weak], posts);

    expect(matches.map((m) => m.score)).toEqual([...matches.map((m) => m.score)].sort((a, b) => b - a));
  });

  it("returns nothing for an empty board or an empty feed, rather than throwing", () => {
    expect(matchFeedToGaps([], [post("anything")])).toEqual([]);
    expect(matchFeedToGaps([CCTP], [])).toEqual([]);
  });

  it("skips a claim with no subject words at all", () => {
    expect(matchFeedToGaps([gap("It is what it is.")], [post("It is what it is")])).toEqual([]);
  });
});
