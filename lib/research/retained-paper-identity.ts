import type { PaperRecord } from "../papers/types";
import { arxivDocumentId } from "../scholarly/arxiv-identity";

/** Resolve a retained read to an included bibliography record, without fetching
 * or rewriting its ledger identity. Only an explicit, canonical same-version
 * arXiv PDF has an additional mapping; all other records retain exact URL matching.
 */
export function retainedPaperRecordUrl(readUrl: string, papers: readonly PaperRecord[]): string | undefined {
  const exact = papers.find(paper => paper.url === readUrl);
  if (exact) return exact.url;
  const id = arxivDocumentId(readUrl);
  if (!id || (readUrl !== `https://arxiv.org/pdf/${id}` && readUrl !== `https://arxiv.org/pdf/${id}.pdf`)) return undefined;
  return papers.find(paper => paper.repository === "arxiv" && paper.arxivId === id
    && paper.url === `https://arxiv.org/abs/${id}`)?.url;
}
