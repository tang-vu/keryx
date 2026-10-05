import type { SourceCandidate } from "../llm";
import { digest, publisherGroup } from "./url-identity";
import type { SearchHit, SearchProvider } from "./search-provider";
import { discussionDoesNotMeetDocumentRequest } from "../research/source-requirements";
import { requestedSources, sourceUrlRefusal, type RequestedSourceLead } from "./requested-sources";
import { canonicalUrl } from "./url-identity";
export type { RequestedSourceLead } from "./requested-sources";

const MAX_CANDIDATES = 24;
// Deep research searches once for the question and once per research target (at most eight).
const MAX_DEEP_QUERIES = 9;

function documentCandidateId(raw: string): string {
  return `public:web:${digest(canonicalUrl(raw) ?? raw)}`;
}

export async function discoverWeb(provider: SearchProvider | null, question: string, claims: string[], quick: boolean, signal?: AbortSignal) {
  const queries = provider ? [...new Set([question, ...claims].map(query => query.trim().slice(0, 500)))].filter(Boolean).slice(0, quick ? 2 : MAX_DEEP_QUERIES) : [];
  const candidates = new Map<string, SourceCandidate>(); const hosts = new Map<string, number>(); let failedQueries = 0, attemptedQueries = 0, succeededQueries = 0;
  const withheldDiscussions = new Set<string>();
  const supplied = requestedSources(question);
  const leads: RequestedSourceLead[] = supplied.leads.map(lead => signal?.aborted && !lead.refusal
    ? { url: lead.url, refusal: "cancelled" } : lead);
  for (const lead of leads) if (lead.refusal === "discussion-does-not-meet-document-request") withheldDiscussions.add(lead.url);
  if (!signal?.aborted) for (const [id, candidate] of supplied.candidates) {
    candidates.set(id, candidate);
  }
  // Explicit requests have their own finite eight-lead limit. Search publisher
  // slots constrain additional previews, not the caller's named originals.
  // Deep searches run together within the existing bounded provider/allowance
  // admission. Quick keeps its sequential searches and full shared candidate cap.
  async function search(query: string) {
    if (signal?.aborted) return [];
    // Count dispatched calls and provider outcomes even when cancellation prevents
    // admitting their previews. These counters do not establish supplier billing.
    attemptedQueries++;
    try {
      const hits = await provider!.search(query, signal);
      succeededQueries++;
      return hits;
    } catch (error) {
      failedQueries++;
      throw error;
    }
  }
  function admitNext(hits: Iterator<SearchHit>): boolean {
    for (let entry = hits.next(); !entry.done; entry = hits.next()) {
      const hit = entry.value;
      // A search response cannot re-admit a URL refused by the caller-lead path.
      if (sourceUrlRefusal(hit.url)) continue;
      // Apply the negative document-role requirement before per-publisher slots are consumed.
      // This never invents a replacement URL or makes another search request.
      if (discussionDoesNotMeetDocumentRequest(question, hit.url)) { withheldDiscussions.add(hit.url); continue; }
      const id = documentCandidateId(hit.url); const group = publisherGroup(hit.url);
      if (candidates.has(id) || (hosts.get(group) ?? 0) >= 2) continue;
      hosts.set(group, (hosts.get(group) ?? 0) + 1);
      candidates.set(id, { id, sourceId: id, sourceKind: "public-reference", name: hit.title,
        description: `Public web discovery from ${group}. Search snippet is an unverified preview; original page must be read. No creator payment.`,
        tags: ["public-web"], fetchPrice: 0, cached: false, preview: hit.snippet.replace(/<[^>]*>/g, " "),
        item: { sourceKind: "public-reference", itemId: digest(hit.url), itemTitle: hit.title, itemUrl: hit.url, contentVersion: "unread" } });
      return true;
    }
    return false;
  }
  if (quick) {
    for (const query of queries) {
      if (signal?.aborted) break;
      try {
        const hits = (await search(query))[Symbol.iterator]();
        if (signal?.aborted) break;
        while (candidates.size < MAX_CANDIDATES && admitNext(hits)) { /* retain the full Quick cap */ }
      } catch { if (signal?.aborted) break; }
    }
  } else {
    const searches = signal?.aborted ? [] : await Promise.allSettled(queries.map(search));
    const readers = searches.map(result => result.status === "fulfilled" ? result.value[Symbol.iterator]() : null);
    // Original caller URLs retain their slots. Round-robin the remaining capacity
    // so later targets get a chance before a broad query fills the cap; unused
    // capacity from sparse/duplicate queries remains available to the others.
    let added = true;
    while (!signal?.aborted && candidates.size < MAX_CANDIDATES && added) {
      added = false;
      for (const [index, hits] of readers.entries()) {
        if (signal?.aborted || candidates.size >= MAX_CANDIDATES) break;
        if (!hits) continue;
        try { if (admitNext(hits)) added = true; }
        catch { readers[index] = null; }
      }
    }
  }
  return { candidates, queries: queries.length, attemptedQueries, succeededQueries, failedQueries, cancelled: !!signal?.aborted,
    requestedSources: leads, omittedRequestedSources: supplied.omitted,
    withheldDiscussionPreviews: withheldDiscussions.size,
    truncatedQueries: [question, ...claims].some(query => query.trim().length > 500) };
}
