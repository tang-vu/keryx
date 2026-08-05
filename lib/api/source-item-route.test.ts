import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { sourceItemIdentity } from "@/lib/sources/source-item-asset";
import type { ArticleOffer, Source, SourceItem } from "@/lib/types";
import { articleOfferId, articleOfferTypedData } from "@/lib/offers/article-offer";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  settleThenServe: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/x402-server", () => ({ settleThenServe: mocks.settleThenServe }));

import { GET } from "@/app/api/source/[id]/item/[itemId]/route";

const source: Source = {
  id: "source-1",
  name: "Source One",
  url: "https://example.test",
  description: "Publication",
  walletAddress: "0x0000000000000000000000000000000000000001",
  fetchPrice: 0.004,
  tags: ["arc"],
  authors: [],
  createdAt: "2026-08-01T00:00:00.000Z",
};

const item: SourceItem = {
  id: "article-1",
  sourceId: source.id,
  title: "Arc settlement",
  summary: "Free preview",
  content: "The exact paid article body.",
  link: "https://example.test/arc-settlement",
  publishedAt: "2026-08-03T00:00:00.000Z",
};

describe("paid article route", () => {
  const db = {
    getSource: vi.fn(),
    getItem: vi.fn(),
    getCached: vi.fn(),
    setCached: vi.fn(),
    getArticleOffer: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.getSource.mockResolvedValue(source);
    db.getItem.mockResolvedValue(item);
    db.getCached.mockResolvedValue(null);
    db.setCached.mockResolvedValue(undefined);
    db.getArticleOffer.mockResolvedValue(null);
    mocks.getDb.mockResolvedValue(db);
    mocks.settleThenServe.mockResolvedValue(Response.json({ challenged: true }));
  });

  it("rejects a stale version before creating an x402 challenge", async () => {
    const response = await GET(
      new NextRequest("https://keryx.test/api/source/source-1/item/article-1?version=sha256:stale"),
      { params: Promise.resolve({ id: source.id, itemId: item.id }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.settleThenServe).not.toHaveBeenCalled();
  });

  it("binds the challenge and paid response to one exact article version", async () => {
    const identity = sourceItemIdentity(item);
    const response = await GET(
      new NextRequest(
        `https://keryx.test/api/source/source-1/item/article-1?version=${encodeURIComponent(identity.contentVersion)}`,
      ),
      { params: Promise.resolve({ id: source.id, itemId: item.id }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.settleThenServe).toHaveBeenCalledOnce();
    const [, options, produce] = mocks.settleThenServe.mock.calls[0];
    expect(options).toMatchObject({
      priceUsdc: source.fetchPrice,
      payTo: source.walletAddress,
    });
    expect(options.endpoint).toContain(encodeURIComponent(identity.contentVersion));

    await expect(
      produce({ payer: "0xbuyer", transaction: "circle-settlement" }),
    ).resolves.toEqual({
      content: item.content,
      name: source.name,
      item: identity,
      pricing: {
        offerId: null,
        priceUsdc: source.fetchPrice,
        listPriceUsdc: source.fetchPrice,
      },
    });
    expect(db.setCached).toHaveBeenCalledWith(expect.stringMatching(/^article:/), item.content);
  });

  it("rejects a missing offer revision before creating an x402 challenge", async () => {
    const identity = sourceItemIdentity(item);
    const response = await GET(
      new NextRequest(
        `https://keryx.test/api/source/source-1/item/article-1?version=${encodeURIComponent(identity.contentVersion)}&offer=0xmissing`,
      ),
      { params: Promise.resolve({ id: source.id, itemId: item.id }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.settleThenServe).not.toHaveBeenCalled();
  });

  it("issues the challenge at a valid creator-signed offer price", async () => {
    const creator = privateKeyToAccount(`0x${"44".repeat(32)}`);
    const pricedSource = { ...source, walletAddress: creator.address };
    const identity = sourceItemIdentity(item);
    const message = {
      sourceId: source.id,
      itemId: item.id,
      contentVersion: identity.contentVersion,
      priceUsdc6: 1_000,
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      nonce: `0x${"ab".repeat(32)}` as `0x${string}`,
    };
    const signature = await creator.signTypedData(articleOfferTypedData(message));
    const offer: ArticleOffer = {
      id: articleOfferId(signature),
      ...message,
      signer: creator.address,
      signature,
      createdAt: new Date().toISOString(),
    };
    db.getSource.mockResolvedValue(pricedSource);
    db.getArticleOffer.mockResolvedValue(offer);

    const staleCeilingResponse = await GET(
      new NextRequest(
        `https://keryx.test/api/source/source-1/item/article-1?version=${encodeURIComponent(identity.contentVersion)}&offer=${offer.id}&listPriceUsdc6=5000`,
      ),
      { params: Promise.resolve({ id: source.id, itemId: item.id }) },
    );
    expect(staleCeilingResponse.status).toBe(409);
    expect(mocks.settleThenServe).not.toHaveBeenCalled();

    const response = await GET(
      new NextRequest(
        `https://keryx.test/api/source/source-1/item/article-1?version=${encodeURIComponent(identity.contentVersion)}&offer=${offer.id}&listPriceUsdc6=4000`,
      ),
      { params: Promise.resolve({ id: source.id, itemId: item.id }) },
    );

    expect(response.status).toBe(200);
    const [, options, produce] = mocks.settleThenServe.mock.calls[0];
    expect(options).toMatchObject({ priceUsdc: 0.001, payTo: creator.address });
    expect(options.endpoint).toContain(`offer=${offer.id}`);
    expect(options.endpoint).toContain("listPriceUsdc6=4000");
    await expect(produce({ payer: "0xbuyer", transaction: "settled" })).resolves.toMatchObject({
      pricing: { offerId: offer.id, priceUsdc: 0.001, listPriceUsdc: 0.004 },
    });
  });
});
