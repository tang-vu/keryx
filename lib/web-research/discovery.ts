import type { SourceCandidate } from "../llm";
import { digest, publisherGroup } from "./url-identity";
import type { SearchProvider } from "./search-provider";

const MAX_CANDIDATES = 24;
const MAX_DEEP_QUERIES = 9; // the question plus MAX_RESEARCH_TARGETS

export async function discoverWeb(provider: SearchProvider, question: string, claims: string[], quick: boolean, signal?: AbortSignal) {
  // Deep research searches once per research target: a cap below the target count left the later
  // targets (typically the named candidates of a comparison) with no discovery at all.
  const queries = [...new Set([question, ...claims].map(query => query.trim().slice(0, 500)))].filter(Boolean).slice(0, quick ? 2 : MAX_DEEP_QUERIES);
  // Share the candidate cap between queries so the first broad query cannot fill it alone.
  const perQuery = Math.max(2, Math.floor(MAX_CANDIDATES / Math.max(1, queries.length)));
  const candidates = new Map<string, SourceCandidate>(); const hosts = new Map<string, number>(); let failedQueries = 0, attemptedQueries = 0, succeededQueries = 0;
  // Searches run together: one per research target in sequence would spend most of the run's web
  // time budget before a single page is read. Hits are admitted in query order, so the result is
  // the same as a sequential pass.
  const searches = signal?.aborted ? [] : await Promise.allSettled(queries.map(query => provider.search(query, signal)));
  for (const search of searches) {
    if (signal?.aborted) break;
    try {
      attemptedQueries++;
      if (search.status === "rejected") throw search.reason;
      let admitted = 0;
      for (const hit of search.value) {
        const id = `public:web:${digest(hit.url)}`; const group = publisherGroup(hit.url);
        if (candidates.has(id) || (hosts.get(group) ?? 0) >= 2 || candidates.size >= MAX_CANDIDATES || admitted >= perQuery) continue;
        admitted++;
        hosts.set(group, (hosts.get(group) ?? 0) + 1);
        candidates.set(id, { id, sourceId: id, sourceKind: "public-reference", name: hit.title,
          description: `Public web discovery from ${group}. Search snippet is an unverified preview; original page must be read. No creator payment.`,
          tags: ["public-web"], fetchPrice: 0, cached: false, preview: hit.snippet.replace(/<[^>]*>/g, " "),
          item: { sourceKind: "public-reference", itemId: digest(hit.url), itemTitle: hit.title, itemUrl: hit.url, contentVersion: "unread" } });
      }
      succeededQueries++;
    } catch { if (signal?.aborted) break; failedQueries++; }
  }
  return { candidates, queries: queries.length, attemptedQueries, succeededQueries, failedQueries, cancelled: !!signal?.aborted,
    truncatedQueries: [question, ...claims].some(query => query.trim().length > 500) };
}
