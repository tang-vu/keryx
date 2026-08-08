import { describe, expect, it } from "vitest";
import type { KeryxDB } from "./db/keryx-db";
import {
  GapOfferError,
  resolveExistingArticleGapOffer,
  resolveGapOffer,
} from "./demand-intent";
import { buildDemand } from "./demand-signal";
import type { QueryRun, SourceItem } from "./types";
import { WANTED_DETAIL_LIMIT } from "./wanted-limits";

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

  it("rechecks that the selected post actually matches the live claim preview", async () => {
    const unrelated = {
      ...post,
      title: "Summer recipes",
      summary: "Tomatoes, basil, and olive oil.",
      link: "https://example.com/recipes",
    };
    await expect(
      resolveGapOffer(
        dbWithRuns([failed]),
        gap.id,
        unrelated.link,
        [unrelated],
      ),
    ).rejects.toThrow("no longer matches");
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

  it("accepts a live brief below the condensed top-400 board cutoff", async () => {
    const alpha = (value: number) => {
      let out = "";
      for (let n = value; n >= 0; n = Math.floor(n / 26) - 1) {
        out = String.fromCharCode(97 + (n % 26)) + out;
      }
      return out;
    };
    const rankedClaim = (runIndex: number, claimIndex: number) =>
      `Missing evidence for uniquetopic${alpha(runIndex * 4 + claimIndex)} protocol`;
    const higherRanked = Array.from({ length: 120 }, (_, runIndex) => ({
      ...failed,
      id: `higher-${runIndex}`,
      question: `Higher-ranked question ${runIndex}`,
      subClaims: Array.from({ length: 4 }, (_, claimIndex) => rankedClaim(runIndex, claimIndex)),
      claimCoverage: Array.from({ length: 4 }, (_, claimIndex) => {
        const claim = rankedClaim(runIndex, claimIndex);
        return { claimIndex, claim, coverage: 0, coveredBy: [] };
      }),
      createdAt: `2026-07-29T${String(runIndex % 24).padStart(2, "0")}:00:00.000Z`,
    }));
    const runs = [...higherRanked, failed];

    expect(buildDemand(runs, { limit: WANTED_DETAIL_LIMIT }).findIndex((item) => item.id === gap.id))
      .toBeGreaterThanOrEqual(400);
    await expect(resolveGapOffer(dbWithRuns(runs), gap.id, post.link, [post])).resolves.toMatchObject({
      gapId: gap.id,
      sourceItemLink: post.link,
    });
  });
});

describe("resolveExistingArticleGapOffer", () => {
  it("binds the live gap to the exact stored article version", async () => {
    const item: SourceItem = { ...post, id: "article-1", sourceId: "source-1" };
    const { sourceItemContentVersion } = await import("./sources/source-item-asset");
    const version = sourceItemContentVersion(item);
    await expect(
      resolveExistingArticleGapOffer(dbWithRuns([failed]), gap.id, item, version, "offer-1"),
    ).resolves.toMatchObject({
      gapId: gap.id,
      itemId: item.id,
      contentVersion: version,
      articleOfferId: "offer-1",
    });
  });

  it("rejects a stale browser-carried article version", async () => {
    const item: SourceItem = { ...post, id: "article-1", sourceId: "source-1" };
    await expect(
      resolveExistingArticleGapOffer(dbWithRuns([failed]), gap.id, item, "sha256:stale"),
    ).rejects.toThrow("version changed");
  });
});
