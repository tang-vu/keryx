/**
 * Slicing the answer archive into crawlable pages.
 *
 * The archive index used to render every entry on one page. At a few hundred answers that was
 * already a two-megabyte document — each card ships twice, once as HTML and once in the RSC
 * payload — and the corpus only grows. A crawler will fetch a page that size, but it spends its
 * budget on one URL instead of many, and a reader on a phone waits for answers they'll never
 * scroll to.
 *
 * So the index is paginated: page 1 lives at /answers (the canonical entry point, and what the
 * feed and topic chips point at), older pages at /answers/page/2 and up. Every page is a real
 * server-rendered document with its own place in the sitemap, and consecutive pages link to each
 * other so a crawler can walk the whole corpus from the index alone.
 */

import type { ArchiveEntry } from "./answers-archive";

/** Entries per page. Sized so a page stays a few hundred KB rather than a few MB. */
export const ANSWERS_PAGE_SIZE = 60;

export interface ArchivePage {
  /** Entries to render on this page, newest first. */
  items: ArchiveEntry[];
  /** 1-based page number, clamped into range. */
  page: number;
  totalPages: number;
  /** Everything not on this page — the filter still searches the whole archive from here. */
  rest: ArchiveEntry[];
}

/** Parse a page segment from the URL. Anything that isn't a plain integer ≥ 1 is not a page. */
export function parsePageParam(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Slice the archive for one page. An out-of-range page yields no items, so the route can 404. */
export function paginateArchive(entries: ArchiveEntry[], page: number): ArchivePage {
  const totalPages = Math.max(1, Math.ceil(entries.length / ANSWERS_PAGE_SIZE));
  const start = (page - 1) * ANSWERS_PAGE_SIZE;
  const items = entries.slice(start, start + ANSWERS_PAGE_SIZE);
  return {
    items,
    page,
    totalPages,
    rest: [...entries.slice(0, start), ...entries.slice(start + ANSWERS_PAGE_SIZE)],
  };
}

/** Canonical path for a page of the archive — page 1 is /answers, never /answers/page/1. */
export function answersPagePath(page: number): string {
  return page <= 1 ? "/answers" : `/answers/page/${page}`;
}
