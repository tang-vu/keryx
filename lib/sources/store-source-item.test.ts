import { afterEach, describe, expect, it } from "vitest";

import { decryptContent } from "../ipfs/content-crypto";
import type { SourceItem } from "../types";
import { contentBodyHash, contentBytes } from "./content-receipt";
import { storeSourceItem } from "./store-source-item";

const ORIGINAL_PINATA = process.env.PINATA_JWT;
const ORIGINAL_KEY = process.env.CONTENT_MASTER_KEY;
const body = "A complete article body kept outside the database.";
const item: SourceItem = {
  id: "article-1",
  sourceId: "source-1",
  title: "Article",
  summary: "Preview",
  content: body,
  link: "https://publisher.test/article-1",
  deliveryKind: "full_text",
};

afterEach(() => {
  if (ORIGINAL_PINATA === undefined) delete process.env.PINATA_JWT;
  else process.env.PINATA_JWT = ORIGINAL_PINATA;
  if (ORIGINAL_KEY === undefined) delete process.env.CONTENT_MASTER_KEY;
  else process.env.CONTENT_MASTER_KEY = ORIGINAL_KEY;
});

describe("shared source-item storage boundary", () => {
  it("pins ciphertext, clears DB plaintext, and records a decryptable v2 envelope", async () => {
    process.env.PINATA_JWT = "test-token";
    process.env.CONTENT_MASTER_KEY = "67".repeat(32);
    let pinned: Buffer | undefined;
    const stored = await storeSourceItem(item, {
      requireEncrypted: true,
      pin: async (ciphertext) => {
        pinned = ciphertext;
        return "bafy-content";
      },
    });

    expect(stored).toMatchObject({
      content: "",
      ipfsCid: "bafy-content",
      storageMode: "ipfs_encrypted",
      deliveryKind: "full_text",
      plaintextBytes: contentBytes(body),
      bodyHash: contentBodyHash(body),
    });
    expect(stored.itemWrapIv).toBeTruthy();
    expect(
      decryptContent(
        pinned!.toString("base64"),
        stored.itemKeyEnc!,
        stored.itemIv!,
        stored.itemAuthTag!,
        stored.itemWrapIv,
      ),
    ).toBe(body);
  });

  it("does not erase receipt metadata when an already-encrypted row crosses the boundary", async () => {
    const stored = await storeSourceItem({
      ...item,
      content: "",
      ipfsCid: "bafy-existing",
      plaintextBytes: contentBytes(body),
      bodyHash: contentBodyHash(body),
      storageMode: "ipfs_encrypted",
    });
    expect(stored.plaintextBytes).toBe(contentBytes(body));
    expect(stored.bodyHash).toBe(contentBodyHash(body));
  });

  it("keeps ciphertext in the private DB when Pinata is unavailable", async () => {
    delete process.env.PINATA_JWT;
    process.env.CONTENT_MASTER_KEY = "78".repeat(32);
    const stored = await storeSourceItem(item, { requireEncrypted: true });

    expect(stored.storageMode).toBe("db_encrypted");
    expect(stored.content).not.toBe(body);
    expect(stored.content).not.toContain(body);
    expect(
      decryptContent(
        stored.content,
        stored.itemKeyEnc!,
        stored.itemIv!,
        stored.itemAuthTag!,
        stored.itemWrapIv,
      ),
    ).toBe(body);
    await expect(storeSourceItem(stored, { requireEncrypted: true })).resolves.toEqual(stored);
  });
});
