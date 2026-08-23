import { describe, expect, it } from "vitest";

import { checkCitedVersions } from "./answers-version-audit";
import type { KeryxDB } from "./db/keryx-db";
import { sourceItemContentVersion } from "./sources/source-item-asset";
import type { Citation } from "./types";

function cite(sourceId: string, marker: string): Citation {
  return {
    marker,
    sourceId,
    sourceName: sourceId,
    weight: 1,
    reward: 0.001,
    rationale: "",
  };
}

describe("checkCitedVersions", () => {
  const currentItem = {
    id: "article-1",
    sourceId: "a",
    title: "Current article",
    summary: "Public summary",
    content: "Paid body",
    link: "https://example.test/article-1",
  };

  it("separates current, superseded and unavailable exact article receipts", async () => {
    const currentVersion = sourceItemContentVersion(currentItem);
    const citations: Citation[] = [
      {
        ...cite("a", "S1"),
        itemId: currentItem.id,
        itemTitle: currentItem.title,
        contentVersion: currentVersion,
      },
      { ...cite("a", "S2"), itemId: currentItem.id, contentVersion: "sha256:older" },
      { ...cite("a", "S3"), itemId: "missing", contentVersion: "sha256:missing" },
      cite("legacy", "S4"),
    ];
    const db = {
      async getItem(_sourceId: string, itemId: string) {
        return itemId === currentItem.id ? currentItem : null;
      },
    };

    const checks = await checkCitedVersions(db as Pick<KeryxDB, "getItem">, citations);
    expect(checks.map((item) => item.status)).toEqual([
      "current",
      "superseded",
      "unavailable",
    ]);
    expect(checks[0]).toMatchObject({ currentVersion, citedVersion: currentVersion });
    expect(checks.some((item) => item.sourceId === "legacy")).toBe(false);
  });

  it("turns an adapter failure into unavailable metadata instead of breaking the dispatch", async () => {
    const citation = {
      ...cite("a", "S1"),
      itemId: "article-1",
      contentVersion: "sha256:receipt",
    };
    const db = { getItem: async () => Promise.reject(new Error("db offline")) };
    await expect(
      checkCitedVersions(db as Pick<KeryxDB, "getItem">, [citation]),
    ).resolves.toMatchObject([{ status: "unavailable" }]);
  });
});
