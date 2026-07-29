import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demandGapId, type DemandGap } from "./demand-signal";
import type { QueryRun } from "./types";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  judge: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  clientIp: () => "test-ip",
}));
vi.mock("@/lib/net/public-fetch", () => ({
  fetchPublicText: async () => "<rss />",
  UnsafeTargetError: class UnsafeTargetError extends Error {},
}));
vi.mock("@/lib/ingest/rss", () => ({
  ingestRssXml: () => ({
    feedTitle: "Writer",
    feedDescription: "Settlement notes",
    link: "https://writer.example",
    items: [
      {
        title: "A relevant post",
        summary: "Details",
        link: "https://writer.example/post",
      },
    ],
  }),
}));
vi.mock("@/lib/llm", () => ({ getReasoningEngine: () => ({ name: "test" }) }));
vi.mock("@/lib/demand-match-judge", () => ({
  judgeFeedAgainstGaps: mocks.judge,
}));

import { POST } from "@/app/api/wanted/match/route";

const CCTP = "CCTP transfers USDC across domains with burn and mint.";
const GATEWAY = "Circle Gateway batches sub-cent USDC settlement.";

function run(id: string, claim: string): QueryRun {
  return {
    id,
    question: `Question for ${claim}`,
    budget: 0.05,
    engine: "llm:test",
    subClaims: [claim],
    decisions: [],
    citations: [],
    evidence: [],
    claimCoverage: [{ claimIndex: 0, claim, coverage: 0, coveredBy: [] }],
    answer: "",
    totalSpent: 0,
    totalToCreators: 0,
    trace: [],
    createdAt: "2026-07-29T00:00:00.000Z",
  };
}

function request(gapId: string) {
  return new NextRequest("http://localhost/api/wanted/match", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rssUrl: "https://writer.example/feed.xml", gapId }),
  });
}

describe("scoped wanted feed matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.getDb.mockResolvedValue({
      listRecentQueries: async () => [run("q1", CCTP), run("q2", GATEWAY)],
    });
    mocks.judge.mockImplementation(async (gaps: DemandGap[]) => ({
      judged: "model",
      wouldBuy: true,
      rationale: "relevant",
      expectedValue: 0.8,
      matches: gaps.map((gap) => ({
        gap,
        shared: [],
        post: {
          title: "A relevant post",
          summary: "Details",
          link: "https://writer.example/post",
        },
      })),
    }));
  });

  it("puts only the current shared claim in front of the judge", async () => {
    const response = await POST(request(demandGapId(GATEWAY)));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.gapsChecked).toBe(1);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].claim).toBe(GATEWAY);
    expect(mocks.judge.mock.calls[0]![0]).toHaveLength(1);
  });

  it("refuses a stale opaque id instead of widening back to the whole board", async () => {
    const response = await POST(request("f".repeat(64)));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "wanted claim unavailable" });
    expect(mocks.judge).not.toHaveBeenCalled();
  });
});
