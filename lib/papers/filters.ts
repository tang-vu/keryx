import type { PaperFilters, PaperRecord } from "./types";
import { normalizeDoi } from "../scholarly/doi";
import { normalizeSearchText } from "../normalize-search-text";

export function paperMatches(record: PaperRecord, filters: PaperFilters): boolean {
  const tokens = (value: string) => normalizeSearchText(value).split(/\s+/u).filter(Boolean);
  const text = normalizeSearchText([record.title, ...record.authors, record.venue, record.doi, record.arxivId, record.url].filter(Boolean).join(" "));
  return tokens(filters.q).every(term => text.includes(term))
    && (!filters.author || record.authors.some(author => tokens(filters.author!).every(term => normalizeSearchText(author).includes(term))))
    && (!filters.year || String(record.publishedYear) === filters.year)
    && (!filters.doi || record.doi === normalizeDoi(filters.doi));
}
