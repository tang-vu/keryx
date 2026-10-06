import type { PaperFilters, PaperRecord } from "./types";
import { normalizeDoi } from "../scholarly/doi";

const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
export function paperMatches(record: PaperRecord, filters: PaperFilters): boolean {
  const tokens = (value: string) => normalized(value).split(/\s+/u).filter(Boolean);
  const text = normalized([record.title, ...record.authors, record.venue, record.doi, record.arxivId, record.url].filter(Boolean).join(" "));
  return tokens(filters.q).every(term => text.includes(term))
    && (!filters.author || record.authors.some(author => tokens(filters.author!).every(term => normalized(author).includes(term))))
    && (!filters.year || String(record.publishedYear) === filters.year)
    && (!filters.doi || record.doi === normalizeDoi(filters.doi));
}
