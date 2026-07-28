import { describe, expect, it } from "vitest";
import type { KeryxDB } from "./db/keryx-db";
import {
  GapOfferError,
  resolveGapOffer,
} from "./demand-intent";
import { buildDemand } from "./demand-signal";
import type { QueryRun, SourceItem } from "./types";

const CLAIM = "CCTP burns and mints USDC across domains.";
const failed: QueryRun = {
  id: "failed-1",
  question: "How does CCTP transfer USDC?",
  budget: 0.05,
  engine: "llm:test",
  subClaims: [CLAIM],
  decisions: [],
  citations: [],
  claimCoverage: [
    { claimIndex: 0, claim: CLAIM, coverage: 0.1, coveredBy: [] },
  ],
  evidence: [],
  answer: "",
  totalSpent: 0,
  totalToCreators: 0,
  trace: [],
  createdAt: "2026-07-28T00:00:00.000Z",
};
const gap = buildDemand([failed])[0]!;
const post: Omit<SourceItem, "id" | "sourceId"> = {
  title: "How CCTP works",
  summary: "Burn on one domain and mint on another.",
  content: "Full post",
  link: "https://example.com/cctp#overview",
};

function dbWithRuns(runs: QueryRun[]): KeryxDB {
  return {
    listRecentQueries: async () => runs,
  } as unknown as KeryxDB;
}

describe("resolveGapOffer", () => {
  it("trusts neither claim text nor post ownership from the browser", async () => {
    await expect(
      resolveGapOffer(
        dbWithRuns([failed]),
        gap.id,
        "https://example.com/cctp",
        [post],
      ),
    ).resolves.toEqual({
      gapId: gap.id,
      claim: CLAIM,
      question: failed.question,
      failedQueryId: failed.id,
      sourceItemLink: post.link,
    });
  });

  it("rejects a post that is not in the feed Keryx just ingested", async () => {
    await expect(
      resolveGapOffer(
        dbWithRuns([failed]),
        gap.id,
        "https://attacker.example/not-in-feed",
        [post],
      ),
    ).rejects.toBeInstanceOf(GapOfferError);
  });

  it("rejects a gap once a later run has filled it", async () => {
    const filled: QueryRun = {
      ...failed,
      id: "filled-1",
      claimCoverage: [
        { claimIndex: 0, claim: CLAIM, coverage: 0.8, coveredBy: ["S1"] },
      ],
      createdAt: "2026-07-28T01:00:00.000Z",
    };
    await expect(
      resolveGapOffer(dbWithRuns([failed, filled]), gap.id, post.link, [post]),
    ).rejects.toThrow("already been filled");
  });
});
