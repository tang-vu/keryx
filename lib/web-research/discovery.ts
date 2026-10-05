import type { SourceCandidate } from "../llm";
import { digest, publisherGroup } from "./url-identity";
import type { SearchProvider } from "./search-provider";
import { discussionDoesNotMeetDocumentRequest, requestedSourceUrls } from "../research/source-requirements";
import { isIP } from "node:net";
import { isPublicAddress } from "../net/public-fetch";

export interface RequestedSourceLead { url: string; candidateId?: string; refusal?: string }

/** This is a syntax/literal-host refusal only. Actual reads still require the ordinary
 * DNS-pinned public transport, redirect/final-URL, format, byte and time checks. */
function requestedUrlRefusal(raw: string): string | undefined {
  if (raw.length > 2000) return "requested-url-length-limit";
  try {
    const url = new URL(raw), host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (url.username || url.password) return "url-credentials";
    if (url.protocol !== "https:") return "https-required";
    if (url.port && url.port !== "443") return "unsupported-port";
    if (host === "localhost" || host.endsWith(".localhost") || isIP(host) && !isPublicAddress(host)) return "non-public-literal-host";
  } catch { return "invalid-url"; }
}

/** Fragments identify requested sections, not separate document bodies/read slots. */
function documentCandidateId(raw: string): string {
  try { const url = new URL(raw); url.hash = ""; return `public:web:${digest(url.href)}`; }
  catch { return `public:web:${digest(raw)}`; }
}

function leadDisplayUrl(raw: string): string {
  // Malformed hosts can make URL parsing fail before userinfo is available.
  // Conservatively suppress a credential-looking raw authority in that case too.
  if (/^https?:\/\/[^/?#]*@/i.test(raw)) return "[credential-bearing URL withheld]";
  try { const url = new URL(raw); if (url.username || url.password) return "[credential-bearing URL withheld]"; }
  catch { /* Keep the caller's malformed spelling for its bounded refusal. */ }
  return raw.slice(0, 2000);
}

export async function discoverWeb(provider: SearchProvider | null, question: string, claims: string[], quick: boolean, signal?: AbortSignal) {
  const queries = provider ? [...new Set([question, ...claims].map(query => query.trim().slice(0, 500)))].filter(Boolean).slice(0, quick ? 2 : 4) : [];
  const candidates = new Map<string, SourceCandidate>(); const hosts = new Map<string, number>(); let failedQueries = 0, attemptedQueries = 0, succeededQueries = 0;
  const withheldDiscussions = new Set<string>();
  const supplied = requestedSourceUrls(question), requestedSources: RequestedSourceLead[] = [];
  for (const url of supplied.urls) {
    let refusal = requestedUrlRefusal(url);
    if (!refusal && signal?.aborted) refusal = "cancelled";
    if (!refusal && discussionDoesNotMeetDocumentRequest(question, url)) {
      withheldDiscussions.add(url); refusal = "discussion-does-not-meet-document-request";
    }
    const id = documentCandidateId(url), group = publisherGroup(url);
    if (!refusal && !candidates.has(id) && (hosts.get(group) ?? 0) >= 2) refusal = "publisher-candidate-limit";
    if (refusal) { requestedSources.push({ url: leadDisplayUrl(url), refusal }); continue; }
    requestedSources.push({ url, candidateId: id });
    const existing = candidates.get(id);
    if (existing) {
      existing.preview = `${existing.preview} Additional requested URL/section: ${url}.`.slice(0, 600);
      continue;
    }
    hosts.set(group, (hosts.get(group) ?? 0) + 1);
    const name = `Requested source: ${url}`;
    candidates.set(id, { id, sourceId: id, sourceKind: "public-reference", name,
      description: `Caller-supplied source URL from ${group}. Unread discovery lead; no official authorship or document contents established. No creator payment.`,
      tags: ["public-web", "requested-source"], fetchPrice: 0, cached: false,
      preview: `Caller requested ${url}. No document text has been read. Any fragment is retained as requested scope; the reader attempts a bounded whole document, not section-specific extraction.`,
      item: { sourceKind: "public-reference", itemId: id.slice("public:web:".length), itemTitle: name, itemUrl: url, contentVersion: "unread" } });
  }
  for (const query of queries) {
    if (signal?.aborted) break;
    try {
      attemptedQueries++;
      for (const hit of await provider!.search(query, signal)) {
        // Apply the negative document-role requirement before per-publisher slots are consumed.
        // This never invents a replacement URL or makes another search request.
        if (discussionDoesNotMeetDocumentRequest(question, hit.url)) { withheldDiscussions.add(hit.url); continue; }
        const id = documentCandidateId(hit.url); const group = publisherGroup(hit.url);
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
    requestedSources, omittedRequestedSources: supplied.omitted,
    withheldDiscussionPreviews: withheldDiscussions.size,
    truncatedQueries: [question, ...claims].some(query => query.trim().length > 500) };
}
