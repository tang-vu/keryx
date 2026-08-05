import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ArticleOffer, Source, SourceItem } from "../types";
import { SqliteAdapter } from "./sqlite-adapter";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-offers-"));
const db = new SqliteAdapter(path.join(dir, "keryx.sqlite"));
const source: Source = {
  id: "source-1",
  name: "Source",
  url: "https://example.test",
  description: "Publication",
  walletAddress: "0x0000000000000000000000000000000000000001",
  fetchPrice: 0.004,
  tags: [],
  authors: [],
  createdAt: "2026-08-05T00:00:00.000Z",
};
const item: SourceItem = {
  id: "article-1",
  sourceId: source.id,
  title: "Article",
  summary: "Preview",
  content: "Paid body",
  link: "https://example.test/article",
};
const offer: ArticleOffer = {
  id: `0x${"aa".repeat(32)}`,
  sourceId: source.id,
  itemId: item.id,
  contentVersion: `sha256:${"bb".repeat(32)}`,
  priceUsdc6: 1_500,
  expiresAt: 2_000_000_000,
  signer: source.walletAddress,
  nonce: `0x${"cc".repeat(32)}`,
  signature: `0x${"dd".repeat(65)}`,
  createdAt: "2026-08-05T00:00:00.000Z",
};

beforeAll(async () => {
  await db.init();
  await db.upsertSource(source);
  await db.addItems([item]);
});

afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SQLite article offer persistence", () => {
  it("atomically replaces one current revision per article", async () => {
    await db.setArticleOffer(offer);
    await expect(db.getArticleOffer(source.id, item.id)).resolves.toEqual(offer);

    const replacement = {
      ...offer,
      id: `0x${"ee".repeat(32)}`,
      priceUsdc6: 900,
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    await db.setArticleOffer(replacement);
    await expect(db.listArticleOffers(source.id)).resolves.toEqual([replacement]);

    await db.deleteArticleOffer(source.id, item.id);
    await expect(db.getArticleOffer(source.id, item.id)).resolves.toBeNull();
  });

  it("persists offer provenance on fetch payment receipts", async () => {
    await db.recordPayment({
      id: "offer-payment",
      kind: "fetch",
      queryId: "q-1",
      sourceId: source.id,
      sourceName: source.name,
      payer: "0x0000000000000000000000000000000000000002",
      payee: source.walletAddress,
      amountUsdc: 0.0015,
      offerId: offer.id,
      listPriceUsdc: 0.004,
      network: "eip155:5042002",
      settled: true,
      settlementStatus: "settled",
      txHash: "settlement-1",
      createdAt: "2026-08-05T00:00:00.000Z",
    });
    const [payment] = await db.listPayments(1);
    expect(payment.offerId).toBe(offer.id);
    expect(payment.listPriceUsdc).toBe(0.004);
  });
});
