import type { ScholarlyMetadata } from "../types";
import { arxivSearch } from "../scholarly/arxiv";
import { crossrefLookup } from "../scholarly/crossref";
import { doiUrl, normalizeDoi } from "../scholarly/doi";
import { fetchMetadata, type MetadataFetch } from "../scholarly/provider";
import { setTimeout as delay } from "node:timers/promises";
import { PAPER_CATALOG } from "./catalog";
import { paperLookupIntent } from "./intent";
import { paperMatches } from "./filters";
import { groupPaperWorks } from "./work-groups";
import { paperRecordSchema, type PaperFilters, type PaperRecord, type PaperSearchResult } from "./types";

export function bibliographicPaper(metadata: ScholarlyMetadata): PaperRecord {
  const arxiv = metadata.provider === "arxiv";
  const authorCount = metadata.authorCount ?? metadata.authors.length;
  return paperRecordSchema.parse({
    title: metadata.title, authors: metadata.authors, authorCount,
    authorsTruncated: authorCount > metadata.authors.length,
    ...(metadata.publishedDate ? { publishedYear: Number(metadata.publishedDate.slice(0, 4)) } : {}),
    ...(metadata.journal ? { venue: metadata.journal } : {}),
    ...(metadata.doi ? { doi: metadata.doi } : {}),
    ...(metadata.arxivId ? { arxivId: metadata.arxivId } : {}),
    repository: metadata.provider,
    url: arxiv ? `https://arxiv.org/abs/${metadata.arxivId}` : doiUrl(metadata.doi!),
    metadataUrl: metadata.recordUrl, metadataObservedAt: metadata.retrievedAt,
    publicationKind: metadata.workType === "other" ? "unknown" : metadata.workType,
    peerReview: "unknown",
    ...(arxiv ? { links: [{ label: "PDF", url: `https://arxiv.org/pdf/${metadata.arxivId}` }] } : {}),
  });
}

/** A library query observes bibliography only; no database, original reads or paid execution. */
export async function searchPaperLibrary(filters: PaperFilters, options: {
  live?: boolean; signal?: AbortSignal; fetcher?: MetadataFetch; catalog?: readonly PaperRecord[];
} = {}): Promise<PaperSearchResult> {
  const catalog = options.catalog ?? PAPER_CATALOG, records: PaperRecord[] = [];
  const providers: PaperSearchResult["providers"] = [];
  if (options.live) {
    const input = filters.doi ? normalizeDoi(filters.doi) : filters.q;
    if (input === undefined) throw new Error("Invalid DOI filter");
    const { query, dois, arxivIds } = paperLookupIntent(input);
    const operations: Array<{ name: "arxiv" | "crossref"; run: () => Promise<ScholarlyMetadata[]> }> = [];
    const fetcher = options.fetcher ?? fetchMetadata;
    // Exact identifiers get exact lookups, without an additional unrelated keyword search.
    dois.forEach((doi, index) => operations.push({ name: "crossref", run: async () => {
      if (index) await delay(1100, undefined, { signal: options.signal });
      return crossrefLookup(query, doi, options.signal, fetcher);
    } }));
    if (arxivIds.length) operations.push({ name: "arxiv", run: () => arxivSearch(query, options.signal, fetcher) });
    if (!dois.length && !arxivIds.length && /[\p{L}\p{N}]{3}/u.test(query)) {
      operations.push({ name: "arxiv", run: () => arxivSearch(query, options.signal, fetcher) },
        { name: "crossref", run: () => crossrefLookup(query, undefined, options.signal, fetcher) });
    }
    for (const operation of operations.slice(0, 2)) {
      if (options.signal?.aborted) break;
      try {
        const observed = (await operation.run()).map(bibliographicPaper);
        records.push(...observed);
        providers.push({ name: operation.name, status: observed.length ? "available" : "empty", records: observed.length });
      } catch { providers.push({ name: operation.name, status: "unavailable", records: 0 }); }
    }
  }
  // Provider search ranks candidate records; AND-token filtering belongs to the curated
  // catalog. Author/year/DOI filters still apply to every displayed observed record.
  const liveRecords = new Set(records);
  records.push(...catalog);
  const groups = groupPaperWorks(records).flatMap(group => {
    const matching = group.records.find(record => paperMatches(record,
      { ...filters, q: liveRecords.has(record) ? "" : filters.q }));
    return matching ? [{ ...group, record: matching }] : [];
  });
  return { version: 1, scope: "bibliography-only", groups, totalWorks: groups.length,
    catalogRecords: catalog.length, providers };
}
