import { normalizeDoi, questionDois } from "../scholarly/doi";
import { arxivDocumentId, normalizeVersionedArxivId, questionArxivIds } from "../scholarly/arxiv-identity";

/** A local bibliography link carries one explicit identity, never the user's full question. */
export function paperLibraryHref(question = ""): string {
  const base = "/sources?kind=paper";
  const input = question.trim();
  const directArxiv = arxivDocumentId(input) ?? normalizeVersionedArxivId(input);
  const directDoi = normalizeDoi(input);
  const arxiv = directArxiv ? [directArxiv] : questionArxivIds(input, 3);
  const dois = directDoi ? [directDoi] : questionDois(input, 3);
  if (arxiv.length + dois.length !== 1) return `${base}#research-papers`;
  const params = new URLSearchParams({ kind: "paper", ...(arxiv.length ? { q: arxiv[0] } : { doi: dois[0] }) });
  return `/sources?${params}#research-papers`;
}
