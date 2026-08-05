import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import type { ArticleOffer, ArticleOfferRef, SourceItemIdentity } from "../types";
import { articleOfferId, articleOfferTypedData } from "../offers/article-offer";
import { validateBrowserFetchPrice } from "./browser-fetch-price-policy";

const creator = privateKeyToAccount(`0x${"66".repeat(32)}`);
const item: SourceItemIdentity = {
  itemId: "article-1",
  itemTitle: "Offer policy",
  itemUrl: "https://example.test/article-1",
  contentVersion: `sha256:${"ab".repeat(32)}`,
};

async function offerProof(): Promise<ArticleOfferRef> {
  const message = {
    sourceId: "source-1",
    itemId: item.itemId,
    contentVersion: item.contentVersion,
    priceUsdc6: 1_000,
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    nonce: `0x${"cd".repeat(32)}` as `0x${string}`,
  };
  const signature = await creator.signTypedData(articleOfferTypedData(message));
  const proof: ArticleOffer = {
    id: articleOfferId(signature),
    ...message,
    signer: creator.address,
    signature,
    createdAt: new Date().toISOString(),
  };
  return {
    id: proof.id,
    priceUsdc: 0.001,
    listPriceUsdc: 0.004,
    expiresAt: proof.expiresAt,
    proof,
  };
}

const authority = {
  wallets: new Set([creator.address.toLowerCase()]),
  fetchPayTo: creator.address.toLowerCase(),
  creator: creator.address,
  listPriceUsdc: 0.004,
  onchain: true,
  active: true,
};

describe("browser fetch price policy", () => {
  it("requires list-price fetches to equal the independently read registry amount", async () => {
    await expect(
      validateBrowserFetchPrice({ sourceId: "source-1", amountUsdc6: "4000", authority }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      validateBrowserFetchPrice({ sourceId: "source-1", amountUsdc6: "5000", authority }),
    ).resolves.toEqual({ allowed: false, reason: "fetch amount does not match the registry list price" });
  });

  it("accepts only the exact amount authorised by the creator's version-bound offer", async () => {
    const offer = await offerProof();
    await expect(
      validateBrowserFetchPrice({
        sourceId: "source-1",
        amountUsdc6: "1000",
        authority,
        context: { item, offer },
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      validateBrowserFetchPrice({
        sourceId: "source-1",
        amountUsdc6: "2000",
        authority,
        context: { item, offer },
      }),
    ).resolves.toEqual({ allowed: false, reason: "fetch amount differs from the signed article offer" });
  });

  it("refuses an inactive registry source before signing", async () => {
    await expect(
      validateBrowserFetchPrice({
        sourceId: "source-1",
        amountUsdc6: "4000",
        authority: { ...authority, active: false },
      }),
    ).resolves.toEqual({ allowed: false, reason: "source is inactive on-chain" });
  });
});
