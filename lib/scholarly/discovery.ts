import type { SourceCandidate } from "../llm";
import type { ScholarlyMetadata } from "../types";
import { digest } from "../web-research/url-identity";
import { arxivSearch } from "./arxiv";
import { crossrefLookup } from "./crossref";
import { doiUrl, questionDois } from "./doi";
import { fetchMetadata, type MetadataFetch } from "./provider";
import { setTimeout as delay } from "node:timers/promises";

export interface ScholarlyDiscovery {
  candidates: Map<string, SourceCandidate>;
  succeeded: number;
  unavailable: number;
  requestedDois: number;
  resolvedDois: number;
}
export type ScholarlyDiscover = (question: string, search: boolean, signal?: AbortSignal) => Promise<ScholarlyDiscovery>;

export function scholarlyCandidate(metadata: ScholarlyMetadata): SourceCandidate {
  const url = metadata.provider === "arxiv" ? `https://arxiv.org/pdf/${metadata.arxivId}` : doiUrl(metadata.doi!);
  const id = `public:scholarly:${digest(metadata.provider + ":" + (metadata.arxivId ?? metadata.doi))}`;
  return { id, sourceId: id, sourceKind: "public-reference", name: metadata.title,
    description: `${metadata.provider === "arxiv" ? "arXiv preprint; try bounded paper PDF, with explicit abstract-page fallback" : "Crossref bibliographic record; original publisher page must be read"}. Peer review unknown. Metadata is discovery only; no creator payment.`,
    tags: ["scholarly", metadata.workType], fetchPrice: 0, cached: false,
    preview: `${metadata.title}. ${metadata.authors.join(", ")}. ${metadata.journal ?? ""} ${metadata.publishedDate ?? ""}`.slice(0, 600),
    item: { sourceKind: "public-reference", itemId: metadata.arxivId ?? metadata.doi!, itemTitle: metadata.title,
      itemUrl: url, contentVersion: "unread", scholarly: metadata } };
}

/** Up to two exact DOI lookups, or one bibliographic search; one arXiv query. */
export async function discoverScholarly(question: string, search: boolean, signal?: AbortSignal, fetcher: MetadataFetch = fetchMetadata): Promise<ScholarlyDiscovery> {
  const dois = questionDois(question), result: ScholarlyDiscovery = { candidates: new Map(), succeeded: 0, unavailable: 0, requestedDois: dois.length, resolvedDois: 0 };
  const operations: Array<() => Promise<ScholarlyMetadata[]>> = [];
  if (dois.length) for (const [index, doi] of dois.entries()) operations.push(async () => {
    if (index) await delay(1100, undefined, { signal });
    return crossrefLookup(question, doi, signal, fetcher);
  });
  else if (search) operations.push(() => crossrefLookup(question, undefined, signal, fetcher));
  if (search) operations.push(() => arxivSearch(question, signal, fetcher));
  for (const operation of operations) {
    if (signal?.aborted) break;
    try {
      const records = await operation(); result.succeeded++;
      for (const record of records) { const candidate = scholarlyCandidate(record); result.candidates.set(candidate.id, candidate); }
      if (records.some(record => record.provider === "crossref" && dois.includes(record.doi!))) result.resolvedDois++;
    } catch { result.unavailable++; }
  }
  return result;
}
