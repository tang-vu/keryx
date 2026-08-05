import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import type { ArticleOffer, SourceItem } from "../types";
import {
  articleOfferId,
  articleOfferTypedData,
  validateArticleOffer,
} from "./article-offer";
import { sourceItemContentVersion } from "../sources/source-item-asset";

const creator = privateKeyToAccount(`0x${"11".repeat(32)}`);
const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
const item: SourceItem = {
  id: "article-1",
  sourceId: "source-1",
  title: "Agent markets",
  summary: "Free discovery metadata",
  content: "Paid evidence",
  link: "https://example.test/agent-markets",
  publishedAt: "2026-08-05T00:00:00.000Z",
};

async function signedOffer(
  overrides: Partial<ArticleOffer> = {},
  signer = creator,
): Promise<ArticleOffer> {
  const message = {
    sourceId: "source-1",
    itemId: item.id,
    contentVersion: sourceItemContentVersion(item),
    priceUsdc6: 1_500,
    expiresAt: 2_000_000_000,
    nonce: `0x${"ab".repeat(32)}` as `0x${string}`,
  };
  const signature = await signer.signTypedData(articleOfferTypedData(message));
  return {
    id: articleOfferId(signature),
    ...message,
    signer: signer.address,
    signature,
    createdAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("creator-signed article offers", () => {
  it("binds the discount to creator, exact version, expiry, and registry ceiling", async () => {
    const offer = await signedOffer();
    await expect(
      validateArticleOffer({
        offer,
        item,
        sourceId: "source-1",
        expectedSigner: creator.address,
        listPriceUsdc: 0.004,
        nowSeconds: 1_900_000_000,
      }),
    ).resolves.toEqual({
      valid: true,
      ref: {
        id: offer.id,
        priceUsdc: 0.0015,
        listPriceUsdc: 0.004,
        expiresAt: offer.expiresAt,
      },
    });
  });

  it("rejects a valid signature from a wallet without source pricing authority", async () => {
    const offer = await signedOffer({}, other);
    const result = await validateArticleOffer({
      offer,
      item,
      sourceId: "source-1",
      expectedSigner: creator.address,
      listPriceUsdc: 0.004,
      nowSeconds: 1_900_000_000,
    });
    expect(result).toEqual({ valid: false, reason: "offer was not signed by the source creator" });
  });

  it("rejects stale-version, expired, over-ceiling, and tampered-id offers", async () => {
    const base = await signedOffer();
    const cases: Array<[ArticleOffer, string, number]> = [
      [{ ...base, contentVersion: "sha256:changed" }, "offer targets a different article version", 1_900_000_000],
      [{ ...base, expiresAt: 1_800_000_000 }, "offer has expired", 1_900_000_000],
      [{ ...base, priceUsdc6: 5_000 }, "offer price exceeds the registry list-price ceiling", 1_900_000_000],
      [{ ...base, id: `0x${"cd".repeat(32)}` }, "offer id does not match its signature", 1_900_000_000],
    ];
    for (const [offer, reason, nowSeconds] of cases) {
      await expect(
        validateArticleOffer({
          offer,
          item,
          sourceId: "source-1",
          expectedSigner: creator.address,
          listPriceUsdc: 0.004,
          nowSeconds,
        }),
      ).resolves.toEqual({ valid: false, reason });
    }
  });
});
