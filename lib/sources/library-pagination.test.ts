import { expect, it } from "vitest";
import { libraryBrowseHref, parseLibraryFilters, type LibraryKind } from "./library-browse";
import { libraryPageNumbers, libraryPaginationHref, paginateLibrary, type LibraryPaginationContext } from "./library-pagination";

const kinds: LibraryKind[] = ["paper", "explore", "cited", "feed", "creator"];
const records = Array.from({ length: 49 }, (_, id) => ({ id }));
const context: LibraryPaginationContext = {
  filters: parseLibraryFilters({ q: "日本語 & {count}", topic: "data-infrastructure", kind: "feed", sort: "recent", author: "Original author", year: "2024", doi: "10.1234/x?y=1" }),
  articles: { query: "Original & article", referenceId: "public:fixture", cursor: "opaque/+?=token", sort: "oldest" },
  pages: { paper: 2, explore: 3, cited: 4, feed: 2, creator: 5 },
};

it.each(kinds)("pages every %s record exactly once in its original order without mutation", kind => {
  const before = JSON.stringify(records), size = kind === "paper" ? 8 : 12;
  const first = paginateLibrary(records, kind, undefined), all = [];
  expect(first.items).toEqual(records.slice(0, size));
  expect(first.totalPages).toBe(Math.ceil(records.length / size));
  for (let page = 1; page <= first.totalPages; page++) {
    const result = paginateLibrary(records, kind, String(page));
    expect(result.page).toBe(page); expect(result.items.length).toBeLessThanOrEqual(size);
    all.push(...result.items);
  }
  expect(all).toEqual(records); expect(JSON.stringify(records)).toBe(before);
});

it.each(["", "0", "-1", "1.5", "1e2", "Infinity", "NaN", "01", " 2", "2 ", "+2", "99999999", "all", "__proto__"].map(value => ({ value })))(
  "defaults malformed page $value to the first bounded slice", ({ value }) => {
    expect(paginateLibrary(records, "feed", value)).toEqual(paginateLibrary(records, "feed", "1"));
  });

it("uses the first repeated page value consistently with existing filter parsers", () => {
  expect(paginateLibrary(records, "feed", ["2", "3"]).items).toEqual(records.slice(12, 24));
  expect(paginateLibrary(records, "feed", ["bad", "2"]).page).toBe(1);
  expect(paginateLibrary(records, "feed", []).page).toBe(1);
});

it("clamps a stale valid page to the last page and leaves an empty collection empty", () => {
  expect(paginateLibrary(records, "feed", "9999999")).toEqual({ items: records.slice(48), page: 5, totalPages: 5 });
  expect(paginateLibrary([], "paper", "7")).toEqual({ items: [], page: 1, totalPages: 1 });
});

it("retains only parsed library/article state and independent collection positions in GET links", () => {
  const before = JSON.stringify(context), url = new URL(libraryPaginationHref(context, "feed", 3), "https://local.test");
  expect(url.pathname).toBe("/sources"); expect(url.hash).toBe("#public-references");
  expect(Object.fromEntries(url.searchParams)).toEqual({ q: context.filters.q, topic: "data-infrastructure", kind: "feed", sort: "recent", author: "Original author", year: "2024", doi: "10.1234/x?y=1", articleQuery: "Original & article", publisher: "public:fixture", articleSort: "oldest", articleCursor: "opaque/+?=token", paperPage: "2", explorePage: "3", citedPage: "4", feedPage: "3", creatorPage: "5" });
  expect(JSON.stringify(context)).toBe(before);
});

it("omits first/default pages and default article state", () => {
  const defaults: LibraryPaginationContext = { filters: parseLibraryFilters({ run: "private-id", sign: "true", all: "1" }), articles: { query: "", referenceId: "", cursor: "", sort: "recent" }, pages: { paper: 1, explore: 1, cited: 1, feed: 1, creator: 1 } };
  expect(libraryPaginationHref(defaults, "paper", 1)).toBe("/sources#research-papers");
  expect(libraryPaginationHref(defaults, "creator", 2)).toBe("/sources?creatorPage=2#creator-listings");
});

it("resets collection positions when an existing library filter link changes its selection", () => {
  const url = new URL(libraryBrowseHref(context.filters, { topic: "payments" }), "https://local.test");
  expect([...url.searchParams.keys()].some(key => key.endsWith("Page"))).toBe(false);
  expect(url.searchParams.get("topic")).toBe("payments");
});

it.each([1, 2, 3, 499999, 999999, 1000000])("bounds numeric links on a million-page directory at page %s", page => {
  const numbers = libraryPageNumbers(page, 1000000);
  expect(numbers.length).toBeLessThanOrEqual(7); expect(numbers).toContain(1); expect(numbers).toContain(1000000); expect(numbers).toContain(page);
  expect(numbers).toEqual([...new Set(numbers)].sort((a, b) => a - b));
  if (page > 1) expect(numbers).toContain(page - 1);
  if (page < 1000000) expect(numbers).toContain(page + 1);
});
