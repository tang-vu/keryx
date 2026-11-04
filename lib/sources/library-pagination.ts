import { libraryBrowseHref, type LibraryFilters, type LibraryKind } from "./library-browse";

const COLLECTIONS = {
  paper: { size: 8, anchor: "research-papers" },
  explore: { size: 12, anchor: "publisher-directory" },
  cited: { size: 12, anchor: "cited-sources" },
  feed: { size: 12, anchor: "public-references" },
  creator: { size: 12, anchor: "creator-listings" },
} as const satisfies Record<LibraryKind, { size: number; anchor: string }>;

export interface LibraryPage<T> {
  items: T[];
  page: number;
  totalPages: number;
}

export interface LibraryPaginationContext {
  filters: LibraryFilters;
  articles: { query: string; referenceId: string; cursor: string; sort: "recent" | "oldest" | "relevance" };
  pages: Record<LibraryKind, number>;
}

/** Slice only after full-directory filtering/sorting, without changing its counts or order. */
export function paginateLibrary<T>(records: readonly T[], kind: LibraryKind, value: string | string[] | undefined): LibraryPage<T> {
  const raw = typeof value === "string" ? value : value?.[0] ?? "";
  const requested = /^[1-9]\d{0,6}$/.test(raw) ? Number(raw) : 1;
  const size = COLLECTIONS[kind].size;
  const totalPages = Math.max(1, Math.ceil(records.length / size));
  const page = Math.min(requested, totalPages);
  return { items: records.slice((page - 1) * size, page * size), page, totalPages };
}

/** At most seven numeric links, regardless of directory size. */
export function libraryPageNumbers(page: number, totalPages: number): number[] {
  const numbers = new Set([1, totalPages]);
  for (let n = Math.max(1, page - 2); n <= Math.min(totalPages, page + 2); n++) numbers.add(n);
  return [...numbers].sort((a, b) => a - b);
}

export function libraryCollectionAnchor(kind: LibraryKind): string {
  return COLLECTIONS[kind].anchor;
}

/** Only parsed presentation state travels to another page; no arbitrary incoming parameters. */
export function libraryPaginationHref(context: LibraryPaginationContext, kind: LibraryKind, page: number): string {
  const href = libraryBrowseHref(context.filters);
  const params = new URLSearchParams(href.split("#")[0].split("?")[1]);
  const articles = context.articles;
  if (articles.query) params.set("articleQuery", articles.query);
  if (articles.referenceId) params.set("publisher", articles.referenceId);
  if (articles.sort !== "recent") params.set("articleSort", articles.sort);
  if (articles.cursor) params.set("articleCursor", articles.cursor);
  for (const collection of Object.keys(COLLECTIONS) as LibraryKind[]) {
    const value = collection === kind ? page : context.pages[collection];
    if (value > 1) params.set(`${collection}Page`, String(value));
  }
  return `/sources${params.size ? `?${params}` : ""}#${COLLECTIONS[kind].anchor}`;
}
