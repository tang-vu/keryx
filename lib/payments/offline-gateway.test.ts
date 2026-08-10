import { afterEach, describe, expect, it } from "vitest";

import type { KeryxDB } from "../db";
import { encryptContent } from "../ipfs/content-crypto";
import type { Source, SourceItem } from "../types";
import { contentBodyHash, contentBytes } from "../sources/content-receipt";
import { OfflineGateway } from "./offline-gateway";

const ORIGINAL_KEY = process.env.CONTENT_MASTER_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.CONTENT_MASTER_KEY;
  else process.env.CONTENT_MASTER_KEY = ORIGINAL_KEY;
});

describe("OfflineGateway encrypted storage compatibility", () => {
  it("simulates payment but still decrypts a db_encrypted article before reasoning", async () => {
    process.env.CONTENT_MASTER_KEY = "9a".repeat(32);
    const plaintext = "Encrypted article used by an explicit offline simulation.";
    const envelope = encryptContent(plaintext);
    const item: SourceItem = {
      id: "article-1",
      sourceId: "source-1",
      title: "Article",
      summary: "Preview",
      content: envelope.cipherB64,
      link: "https://publisher.test/article-1",
      storageMode: "db_encrypted",
      itemKeyEnc: envelope.wrappedKeyB64,
      itemIv: envelope.ivB64,
      itemAuthTag: envelope.authTagB64,
      itemWrapIv: envelope.wrapIvB64,
      bodyHash: contentBodyHash(plaintext),
      plaintextBytes: contentBytes(plaintext),
    };
    const source: Source = {
      id: "source-1",
      name: "Publisher",
      url: "https://publisher.test",
      description: "Publication",
      walletAddress: "0x0000000000000000000000000000000000000001",
      fetchPrice: 0.004,
      tags: [],
      authors: [],
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    const db = { getItems: async () => [item] } as unknown as KeryxDB;
    const result = await new OfflineGateway(db).payFetch({
      source,
      item,
      queryId: "query-1",
    });

    expect(result.content).toBe(plaintext);
    expect(result.payment.settlementStatus).toBe("simulated");
  });
});

