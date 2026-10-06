import { describe, expect, it } from "vitest";
import { PAPER_CATALOG } from "./catalog";
import { paperSearchResultSchema } from "./types";
import { searchPaperLibrary } from "./search";
import { browseLibrary, libraryBrowseHref, parseLibraryFilters } from "../sources/library-browse";

describe("observed starter paper metadata", () => {
  it("loads every real repository record through the strict runtime contract", async () => {
    expect(PAPER_CATALOG).toHaveLength(40);
    expect(new Set(PAPER_CATALOG.map(record => record.url)).size).toBe(40);
    expect(new Set(PAPER_CATALOG.map(record => record.repository))).toEqual(new Set(["arxiv", "openreview", "pmlr", "acl-anthology"]));
    const result = await searchPaperLibrary({ q: "" });
    expect(paperSearchResultSchema.safeParse(result).success).toBe(true);
    for (const record of PAPER_CATALOG) {
      expect(record.peerReview).toBe("unknown"); expect(record.metadataObservedAt.startsWith("2026-10-06T")).toBe(true);
      expect(record).not.toHaveProperty("abstract"); expect(record).not.toHaveProperty("payTo"); expect(record).not.toHaveProperty("content");
    }
  });
  it("shares paper filters and excludes other collections without altering payout sources", () => {
    const paper = PAPER_CATALOG.find(record => record.doi)!;
    const filters = parseLibraryFilters({ author: paper.authors[0], year: String(paper.publishedYear), doi: paper.doi });
    const rows = [{ id: "paper", kind: "paper" as const, name: paper.title, url: paper.url, papers: [paper] },
      { id: "feed", kind: "feed" as const, name: paper.title, url: paper.url }];
    expect(browseLibrary(rows, filters).map(row => row.id)).toEqual(["paper"]);
    const url = new URL(libraryBrowseHref(filters), "https://keryx.cc");
    expect(url.searchParams.get("doi")).toBe(paper.doi); expect(url.searchParams.get("author")).toBe(paper.authors[0]);
    expect(url.searchParams.has("run")).toBe(false);
  });
});
