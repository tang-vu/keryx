import { describe, expect, it } from "vitest";

import type { SourceItem } from "../types";
import {
  selectRelevantSourceItem,
  selectRelevantSourceItems,
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

  it("adds complementary target matches using metadata without inspecting paid bodies", () => {
    const backup = item({ id: "backup", title: "SQLite backup snapshots", summary: "Consistent SQLite snapshots" });
    const replication = item({ id: "replication", title: "Postgres replication", summary: "Replica consistency" });
    const irrelevant = item({ id: "newest", title: "Football results", summary: "Weekend scores" });
    for (const article of [backup, replication, irrelevant]) {
      Object.defineProperty(article, "content", { get() { throw new Error("Paid body inspected during selection"); } });
    }
    expect(selectRelevantSourceItems("Compare SQLite backup snapshots and Postgres replication",
      ["SQLite backup snapshots", "Postgres replication consistency"], [], [irrelevant, backup, replication]))
      .toEqual([backup, replication]);
  });

  it("bounds registered selection to three articles including the overall choice", () => {
    const overview = item({ id: "overview", title: "Cache replica signer recovery", summary: "Overview" });
    const details = ["Replica consistency", "Signer isolation", "Recovery workflow"].map((title, index) =>
      item({ id: `detail-${index}`, title, summary: "Technical details" }));
    expect(selectRelevantSourceItems("Cache replica signer recovery", details.map(article => article.title), [], [overview, ...details]))
      .toEqual([overview, details[0], details[1]]);
  });

  it("does not pad with zero-match, tag-only or already-covered target metadata", () => {
    const relevant = item({ id: "relevant", title: "SQLite backup snapshots" });
    const redundant = item({ id: "redundant", title: relevant.title });
    const tagOnly = item({ id: "tags", title: "Publisher newsletter", summary: "Publisher newsletter" });
    const unrelated = item({ id: "unrelated", title: "Football results" });
    expect(selectRelevantSourceItems("SQLite backup snapshots", ["SQLite backup snapshots"], ["Publisher newsletter"],
      [relevant, redundant, tagOnly, unrelated])).toEqual([relevant]);
    expect(selectRelevantSourceItems("Unmatched question", ["Unmatched target"], [], [unrelated, tagOnly])).toEqual([unrelated]);
    expect(selectRelevantSourceItems("SQLite", [], [], [relevant, redundant])).toEqual([relevant]);
    expect(selectRelevantSourceItems("SQLite", ["backup"], [], [])).toEqual([]);
  });

  it("deduplicates item IDs and canonical documents without collapsing versioned locations", () => {
    const overview = item({ id: "overview", title: "Cache replica signer recovery", summary: "Overview",
      link: "https://example.test/document?a=1&b=2" });
    const alias = item({ id: "alias", title: "Replica consistency", link: "https://EXAMPLE.test/document?utm_source=feed&b=2&a=1#replica" });
    const duplicateId = item({ id: overview.id, title: "Signer isolation", link: "https://example.test/another" });
    const distinct = item({ id: "version-two", title: "Recovery workflow", link: "https://example.test/document?a=1&b=2&version=2" });
    expect(selectRelevantSourceItems("Cache replica signer recovery", ["Replica consistency", "Signer isolation", "Recovery workflow"], [],
      [overview, alias, duplicateId, distinct])).toEqual([overview, distinct]);
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
