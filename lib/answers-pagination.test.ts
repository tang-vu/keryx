/**
 * Slicing the archive into pages. Pins the properties the public URLs depend on: page 1 has one
 * address and one only, every entry appears on exactly one page, and what's off the page is still
 * offered to the filter — a paginated archive that loses entries between pages is worse than the
 * single long page it replaced.
 */

import { describe, expect, it } from "vitest";
import type { ArchiveEntry } from "./answers-archive";
import {
  ANSWERS_PAGE_SIZE,
  answersPagePath,
  paginateArchive,
  parsePageParam,
} from "./answers-pagination";

const entry = (n: number): ArchiveEntry => ({
  id: `d${n}`,
  question: `Question ${n}?`,
  answerSnippet: "…",
  citationCount: 1,
  toCreators: 0.001,
  totalSpent: 0.002,
  sourceNames: ["A source"],
  createdAt: new Date(Date.UTC(2026, 0, 1 + n)).toISOString(),
  confidence: null,
});

const corpus = (n: number) => Array.from({ length: n }, (_, i) => entry(i));

describe("parsePageParam", () => {
  it("accepts plain page numbers", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("42")).toBe(42);
  });

  it("rejects anything that isn't one", () => {
    // Leading zeros, signs, decimals and text would each mint a second URL for the same page.
    for (const bad of ["0", "01", "-1", "1.0", "", " 2", "2 ", "two", "1e3"]) {
      expect(parsePageParam(bad), bad).toBeNull();
    }
  });
});

describe("answersPagePath", () => {
  it("keeps one canonical address for the index", () => {
    expect(answersPagePath(1)).toBe("/answers");
    expect(answersPagePath(0)).toBe("/answers");
    expect(answersPagePath(2)).toBe("/answers/page/2");
  });
});

describe("paginateArchive", () => {
  it("fills a full page and reports the total", () => {
    const entries = corpus(ANSWERS_PAGE_SIZE * 2 + 5);
    const first = paginateArchive(entries, 1);
    expect(first.items).toHaveLength(ANSWERS_PAGE_SIZE);
    expect(first.items[0]!.id).toBe("d0");
    expect(first.totalPages).toBe(3);
  });

  it("covers every entry exactly once across all pages", () => {
    const entries = corpus(ANSWERS_PAGE_SIZE * 2 + 7);
    const { totalPages } = paginateArchive(entries, 1);
    const seen: string[] = [];
    for (let p = 1; p <= totalPages; p++) seen.push(...paginateArchive(entries, p).items.map((e) => e.id));
    expect(seen).toEqual(entries.map((e) => e.id));
    expect(new Set(seen).size).toBe(entries.length);
  });

  it("offers the rest of the archive to the filter", () => {
    const entries = corpus(ANSWERS_PAGE_SIZE + 10);
    const page2 = paginateArchive(entries, 2);
    expect(page2.items).toHaveLength(10);
    expect(page2.rest).toHaveLength(ANSWERS_PAGE_SIZE);
    // Nothing is both on the page and off it.
    const onPage = new Set(page2.items.map((e) => e.id));
    expect(page2.rest.some((e) => onPage.has(e.id))).toBe(false);
  });

  it("yields nothing past the end, so the route can 404 instead of serving an empty page", () => {
    const entries = corpus(5);
    expect(paginateArchive(entries, 2).items).toEqual([]);
    expect(paginateArchive(entries, 99).items).toEqual([]);
  });

  it("reports one page for an empty archive", () => {
    const empty = paginateArchive([], 1);
    expect(empty.totalPages).toBe(1);
    expect(empty.items).toEqual([]);
    expect(empty.rest).toEqual([]);
  });
});
