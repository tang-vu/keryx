import { describe, expect, it } from "vitest";

import type { SourceItem } from "../types";
import { encryptContent } from "../ipfs/content-crypto";
import { contentBodyHash, contentBytes } from "./content-receipt";
import { resolveSourceItemContent } from "./resolve-source-item-content";

const body = "Exact paid article body.";
const item: SourceItem = {
  id: "article-1",
  sourceId: "source-1",
  title: "Article",
  summary: "Safe preview",
  content: body,
  link: "https://publisher.test/article-1",
  bodyHash: contentBodyHash(body),
  plaintextBytes: contentBytes(body),
};
const settle = { payer: "0xbuyer", transaction: "circle-receipt" };

describe("post-settlement content receipt validation", () => {
  it("serves a body that matches its hash and byte receipt", async () => {
    await expect(
      resolveSourceItemContent(item, settle, { allowSummaryFallback: false }),
    ).resolves.toBe(body);
  });

  it("fails exact-article delivery closed when stored content no longer matches", async () => {
    await expect(
      resolveSourceItemContent(
        { ...item, content: `${body} tampered` },
        settle,
        { allowSummaryFallback: false },
      ),
    ).rejects.toThrow("content receipt hash");
  });

  it("degrades a legacy bundle leg to preview instead of discarding the whole response", async () => {
    await expect(
      resolveSourceItemContent(
        { ...item, content: `${body} tampered` },
        settle,
        { allowSummaryFallback: true },
      ),
    ).resolves.toBe(item.summary);
  });

  it("decrypts the private DB ciphertext fallback only inside the paid resolver", async () => {
    const previous = process.env.CONTENT_MASTER_KEY;
    process.env.CONTENT_MASTER_KEY = "89".repeat(32);
    try {
      const envelope = encryptContent(body);
      await expect(
        resolveSourceItemContent(
          {
            ...item,
            content: envelope.cipherB64,
            storageMode: "db_encrypted",
            itemKeyEnc: envelope.wrappedKeyB64,
            itemIv: envelope.ivB64,
            itemAuthTag: envelope.authTagB64,
            itemWrapIv: envelope.wrapIvB64,
          },
          settle,
          { allowSummaryFallback: false },
        ),
      ).resolves.toBe(body);
    } finally {
      if (previous === undefined) delete process.env.CONTENT_MASTER_KEY;
      else process.env.CONTENT_MASTER_KEY = previous;
    }
  });
});
