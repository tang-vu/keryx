import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import type { Source, SourceItem } from "../types";
import { SqliteAdapter } from "./sqlite-adapter";

const ORIGINAL_KEY = process.env.CONTENT_MASTER_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.CONTENT_MASTER_KEY;
  else process.env.CONTENT_MASTER_KEY = ORIGINAL_KEY;
});

describe("SQLite content receipts and private cache", () => {
  it("round-trips publisher proof and stores cached plaintext only as ciphertext", async () => {
    process.env.CONTENT_MASTER_KEY = "56".repeat(32);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-content-"));
    const file = path.join(dir, "keryx.sqlite");
    const db = new SqliteAdapter(file);
    await db.init();
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
    const item: SourceItem = {
      id: "article-1",
      sourceId: source.id,
      title: "Signed article",
      summary: "Preview",
      content: "",
      link: "https://publisher.test/article-1",
      ipfsCid: "bafy-signed",
      itemKeyEnc: "wrapped",
      itemIv: "iv",
      itemAuthTag: "tag",
      itemWrapIv: "wrap-iv",
      deliveryKind: "full_text",
      storageMode: "ipfs_encrypted",
      plaintextBytes: 321,
      bodyHash: `0x${"ab".repeat(32)}`,
      manifest: {
        id: `0x${"cd".repeat(32)}`,
        sourceId: source.id,
        itemId: "article-1",
        canonicalUrl: "https://publisher.test/article-1",
        bodyHash: `0x${"ab".repeat(32)}`,
        plaintextBytes: 321,
        deliveryKind: "full_text",
        signer: source.walletAddress,
        nonce: `0x${"ef".repeat(32)}`,
        signature: `0x${"12".repeat(65)}`,
        createdAt: "2026-08-10T00:00:00.000Z",
      },
    };
    await db.upsertSource(source);
    await db.addItems([item]);
    await db.setCached("article:receipt", "post-settlement secret body");

    await expect(db.getItem(source.id, item.id)).resolves.toMatchObject(item);
    await expect(db.getCached("article:receipt")).resolves.toBe("post-settlement secret body");
    db.close();

    const raw = new DatabaseSync(file, { readOnly: true });
    const row = raw.prepare("SELECT text FROM cache_items WHERE source_id=?").get("article:receipt");
    expect(String(row?.text)).toMatch(/^enc:v2:/);
    expect(String(row?.text)).not.toContain("post-settlement secret body");
    raw.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

