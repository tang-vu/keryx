import { normalizeSearchText } from "../normalize-search-text";
import type { LiteratureEntry } from "./literature-workspace";

/** Search saved metadata and notes without changing records or their exact identities. */
export function searchLiteratureEntries(entries: readonly LiteratureEntry[], query: string): LiteratureEntry[] {
  const terms = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
  return entries.filter(({ paper, notes }) => {
    if (!terms.length) return true;
    const text = normalizeSearchText([paper.title, ...paper.authors, paper.doi, paper.arxivId,
      paper.publishedYear, paper.venue, paper.repository, paper.url, paper.metadataUrl,
      ...(paper.links ?? []).map(link => link.url), notes].filter(Boolean).join(" "));
    return terms.every(term => text.includes(term));
  });
}
