import { arxivDocumentId, normalizeVersionedArxivId, questionArxivIds } from "../scholarly/arxiv-identity";
import { questionDois } from "../scholarly/doi";

/** Standalone exact identity only; prose and arbitrary URLs remain literal queries. */
export function normalizePaperQuery(input: string): string {
  return arxivDocumentId(input) ?? normalizeVersionedArxivId(input)
    ?? normalizeVersionedArxivId(input.replace(/^arxiv\s*:?\s*/i, "")) ?? input;
}

export function paperLookupIntent(input: string) {
  const bareId = normalizeVersionedArxivId(input.trim());
  const query = bareId ? `arXiv ${bareId}` : input;
  const dois = questionDois(query, 3), arxivIds = questionArxivIds(query, 3);
  if (dois.length > 2 || arxivIds.length > 2 || dois.length + (arxivIds.length ? 1 : 0) > 2)
    throw new Error("Split identifiers into searches of at most two provider requests");
  return { query, dois, arxivIds };
}
