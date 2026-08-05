import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sourceItemIdentity } from "@/lib/sources/source-item-asset";
import type { Source, SourceItem } from "@/lib/types";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { GET } from "@/app/api/source/[id]/preview/route";

const source: Source = {
  id: "source-1",
  name: "Source",
  url: "https://example.test",
  description: "Publication",
  walletAddress: "0x0000000000000000000000000000000000000001",
  fetchPrice: 0.004,
  tags: ["arc"],
  authors: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  previewDepth: "locked",
};

const item: SourceItem = {
  id: "article-1",
  sourceId: source.id,
  title: "Exact article",
  summary: "Free summary hidden by creator policy",
  content: "Paid body must never appear in discovery.",
  link: "https://example.test/article-1",
  publishedAt: "2026-08-05T00:00:00.000Z",
};

describe("source preview article discovery", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.getDb.mockResolvedValue({
      getSource: vi.fn().mockResolvedValue(source),
      getItems: vi.fn().mockResolvedValue([item]),
    });
  });

  it("publishes the payable article identity without leaking locked text", async () => {
    const response = await GET(
      new NextRequest(`https://keryx.test/api/source/${source.id}/preview`),
      { params: Promise.resolve({ id: source.id }) },
    );
    const body = await response.json();
    const identity = sourceItemIdentity(item);

    expect(body.preview[0]).toMatchObject({
      assetId: `item:${item.id}`,
      ...identity,
      title: item.title,
    });
    expect(body.preview[0].paidPath).toContain(
      `version=${encodeURIComponent(identity.contentVersion)}`,
    );
    expect(body.preview[0]).not.toHaveProperty("summary");
    expect(JSON.stringify(body)).not.toContain(item.content);
  });
});
