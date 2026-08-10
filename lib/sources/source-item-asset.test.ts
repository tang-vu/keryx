import { describe, expect, it } from "vitest";

import type { SourceItem } from "../types";
import {
  selectRelevantSourceItem,
  sourceItemAssetId,
  sourceItemCacheKey,
  sourceItemContentVersion,
  sourceItemIdentity,
} from "./source-item-asset";

function item(overrides: Partial<SourceItem> & Pick<SourceItem, "id">): SourceItem {
  return {
    sourceId: "source-a",
    title: "Untitled",
    summary: "Summary",
    content: "Paid article body",
    link: `https://example.test/${overrides.id}`,
    ...overrides,
    id: overrides.id,
  };
}

describe("source item assets", () => {
  it("selects the strongest metadata match even when it is not newest", () => {
    const newest = item({ id: "new", title: "Football results", summary: "Weekly sport" });
    const relevant = item({
      id: "arc",
      title: "Arc settlement finality",
      summary: "How Circle receipts survive delivery failures",
    });

    expect(
      selectRelevantSourceItem(
        "How does Arc settlement retain a Circle receipt?",
        ["Explain delivery failure evidence"],
        [],
        [newest, relevant],
      ),
    ).toBe(relevant);
  });

  it("keeps newest-first order when no article metadata matches", () => {
    const newest = item({ id: "new", title: "Alpha" });
    const older = item({ id: "old", title: "Beta" });

    expect(selectRelevantSourceItem("unrelated question", [], [], [newest, older])).toBe(newest);
  });

  it("changes the cache identity when plaintext content changes", () => {
    const before = item({ id: "article", content: "version one" });
    const after = item({ id: "article", content: "version two" });

    expect(sourceItemContentVersion(before)).not.toBe(sourceItemContentVersion(after));
    expect(sourceItemCacheKey(before.sourceId, before)).not.toBe(
      sourceItemCacheKey(after.sourceId, after),
    );
    expect(sourceItemAssetId(before.id)).toBe("item:article");
    expect(sourceItemIdentity(before)).toMatchObject({
      itemId: before.id,
      itemTitle: before.title,
      itemUrl: before.link,
    });
  });

  it("uses the immutable IPFS CID as the encrypted content version", () => {
    const encrypted = item({
      id: "encrypted",
      content: "",
      ipfsCid: "bafy-article",
      deliveryKind: "full_text",
      storageMode: "ipfs_encrypted",
      plaintextBytes: 500,
      bodyHash: `0x${"ab".repeat(32)}`,
    });
    expect(sourceItemContentVersion(encrypted)).toBe("ipfs:bafy-article");
    expect(sourceItemIdentity(encrypted).contentReceipt).toMatchObject({
      deliveryKind: "full_text",
      storageMode: "ipfs_encrypted",
      plaintextBytes: 500,
      bodyHash: encrypted.bodyHash,
    });
  });
});
