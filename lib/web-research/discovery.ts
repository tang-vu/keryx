import type { SourceCandidate } from "../llm";
import { digest, publisherGroup } from "./url-identity";
import type { SearchProvider } from "./search-provider";

export async function discoverWeb(provider: SearchProvider, question: string, claims: string[], quick: boolean, signal?: AbortSignal) {
  const queries = [...new Set([question, ...claims].map(query => query.trim().slice(0, 500)))].filter(Boolean).slice(0, quick ? 2 : 4);
  const candidates = new Map<string, SourceCandidate>(); const hosts = new Map<string, number>(); let failedQueries = 0, attemptedQueries = 0, succeededQueries = 0;
  for (const query of queries) {
    if (signal?.aborted) break;
    try {
      attemptedQueries++;
      for (const hit of await provider.search(query, signal)) {
        const id = `public:web:${digest(hit.url)}`; const group = publisherGroup(hit.url);
        if (candidates.has(id) || (hosts.get(group) ?? 0) >= 2 || candidates.size >= 24) continue;
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
