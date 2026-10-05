import type { SourceCandidate } from "../llm";
import { digest, publisherGroup } from "./url-identity";
import type { SearchProvider } from "./search-provider";
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
  // A cap below the target count left the later targets (typically the named candidates of a
  // comparison) with no discovery at all, and one broad query could fill the candidate cap alone.
  // Each query therefore admits an equal share. Quick research keeps its two queries.
  const perQuery = Math.max(2, Math.floor(MAX_CANDIDATES / Math.max(1, queries.length)));
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
  // Deep searches run together: nine in sequence would spend most of the run's web time budget
  // before a single page is read. Hits are admitted in query order, so the admitted set matches a
  // sequential pass. Quick research stays sequential, as before.
  const searches = signal?.aborted ? [] : quick
    ? null
    : await Promise.allSettled(queries.map(query => provider!.search(query, signal)));
  for (const [index, query] of queries.entries()) {
    if (signal?.aborted) break;
    try {
      attemptedQueries++;
      const settled = searches?.[index];
      if (settled?.status === "rejected") throw settled.reason;
      let admitted = 0;
      for (const hit of settled ? settled.value : await provider!.search(query, signal)) {
        // A search response cannot re-admit a URL refused by the caller-lead path.
        if (sourceUrlRefusal(hit.url)) continue;
        // Apply the negative document-role requirement before per-publisher slots are consumed.
        // This never invents a replacement URL or makes another search request.
        if (discussionDoesNotMeetDocumentRequest(question, hit.url)) { withheldDiscussions.add(hit.url); continue; }
        const id = documentCandidateId(hit.url); const group = publisherGroup(hit.url);
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
    requestedSources: leads, omittedRequestedSources: supplied.omitted,
    withheldDiscussionPreviews: withheldDiscussions.size,
    truncatedQueries: [question, ...claims].some(query => query.trim().length > 500) };
}
