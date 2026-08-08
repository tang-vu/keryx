import { describe, expect, it } from "vitest";

import type { KeryxDB } from "./db/keryx-db";
import { StaleGapIntentTargetError, validateGapIntentTarget } from "./gap-intent-target";
import { sourceItemContentVersion } from "./sources/source-item-asset";
import type { GapIntent, Source, SourceItem } from "./types";

const source: Source = {
  id: "source-1",
  name: "CCTP Notes",
  url: "https://example.com",
  description: "CCTP",
  walletAddress: "0xabc",
  fetchPrice: 0.002,
  tags: [],
  authors: [{ name: "Author", walletAddress: "0xabc", splitWeight: 1 }],
  active: true,
  verified: true,
  createdAt: "2026-08-08T00:00:00.000Z",
};
const item: SourceItem = {
  id: "article-1",
  sourceId: source.id,
  title: "How CCTP burns and mints",
  summary: "CCTP burns USDC on one domain and mints it on another.",
  content: "Paid evidence",
  link: "https://example.com/cctp",
};
const intent: GapIntent = {
  id: "intent-1",
  gapId: "a".repeat(64),
  claim: "CCTP burns and mints USDC",
  question: "How does CCTP work?",
  failedQueryId: "failed-1",
  sourceId: source.id,
  sourceItemLink: item.link,
  itemId: item.id,
  contentVersion: sourceItemContentVersion(item),
  ownerWallet: source.walletAddress,
  status: "running",
  attempts: 1,
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

function db(currentSource = source, currentItem: SourceItem | null = item) {
  return {
    getSource: async () => currentSource,
    getItem: async () => currentItem,
    getArticleOffer: async () => null,
  } as unknown as KeryxDB;
}

describe("validateGapIntentTarget", () => {
  it("returns the immutable candidate target after rechecking creator authority", async () => {
    await expect(validateGapIntentTarget(db(), intent)).resolves.toEqual({
      sourceId: source.id,
      itemId: item.id,
      contentVersion: intent.contentVersion,
    });
  });

  it("expires coordination when the exact article changes", async () => {
    await expect(
      validateGapIntentTarget(db(source, { ...item, content: "changed" }), intent),
    ).rejects.toBeInstanceOf(StaleGapIntentTargetError);
  });

  it("keeps legacy source-only intents compatible with their payout-wallet ownership rule", async () => {
    const legacy = { ...intent, itemId: undefined, contentVersion: undefined };
    await expect(validateGapIntentTarget(db(), legacy)).resolves.toBeUndefined();
  });
});
