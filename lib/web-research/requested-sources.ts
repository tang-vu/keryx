import type { SourceCandidate } from "../llm";
import { canonicalUrl, digest } from "./url-identity";
import { discussionDoesNotMeetDocumentRequest, MAX_REQUESTED_SOURCE_URLS, requestedSourceUrls } from "../research/source-requirements";
import { isIP } from "node:net";
import { isPublicAddress } from "../net/public-fetch";

export const MAX_REQUESTED_DOCUMENTS = MAX_REQUESTED_SOURCE_URLS;
const MAX_REQUESTED_SECTIONS = 4;
const MAX_URL_CHARS = 2000;

export interface RequestedSourceNotice { url: string; reason: string; code?: string }
export interface RequestedSourceLead { url: string; candidateId?: string; refusal?: string }

/** Shared syntax/literal-host admission only; actual reads still need pinned public DNS. */
export function sourceUrlRefusal(raw: string): string | undefined {
  if (raw.length > MAX_URL_CHARS) return "requested-url-length-limit";
  try {
    const url = new URL(raw), host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (url.username || url.password) return "url-credentials";
    if (url.protocol !== "https:") return "https-required";
    if (url.port && url.port !== "443") return "unsupported-port";
    if (host === "localhost" || host.endsWith(".localhost") || isIP(host) && !isPublicAddress(host)) return "non-public-literal-host";
  } catch { return "invalid-url"; }
}

/** Admission is local and bounded. Every actual read still uses the public-only reader.
 * A supplied URL is a request constraint, never a content preview or payout authority. */
export function requestedSources(question: string) {
  const candidates = new Map<string, SourceCandidate>();
  const notices: RequestedSourceNotice[] = [];
  const leads: RequestedSourceLead[] = [];
  const supplied = requestedSourceUrls(question);
  const refuse = (url: string, code: string, reason: string) => { leads.push({ url, refusal: code }); notices.push({ url, reason, code }); };
  for (const raw of supplied.urls) {
    const display = /^https?:\/\/[^/?#]*@/i.test(raw) ? "[credential-bearing URL withheld]" : raw.slice(0, MAX_URL_CHARS);
    const refusal = sourceUrlRefusal(raw);
    if (refusal) {
      const reason: Record<string, string> = {
        "requested-url-length-limit": "URL exceeds the 2000-character limit.",
        "url-credentials": "Credentials in document URLs are refused.",
        "https-required": "The document reader requires HTTPS; no HTTP read or inferred replacement was attempted.",
        "unsupported-port": "Only the standard HTTPS port is supported.",
        "non-public-literal-host": "The supplied literal host is not public; no read was attempted.",
      };
      refuse(display, refusal, reason[refusal] ?? refusal); continue;
    }
    const url = new URL(raw);
    if (discussionDoesNotMeetDocumentRequest(question, raw)) {
      refuse(display, "discussion-does-not-meet-document-request", "A recognized discussion page does not meet the official-document request."); continue;
    }
    const canonical = canonicalUrl(raw);
    if (!canonical) {
      refuse(display, "invalid-url", "invalid-url"); continue;
    }
    const requested = canonical + url.hash;
    const id = `public:web:${digest(canonical)}`;
    const existing = candidates.get(id);
    if (existing?.item?.requestedSource) {
      const urls = existing.item.requestedSource.urls;
      if (!urls.includes(requested) && urls.length < MAX_REQUESTED_SECTIONS) urls.push(requested);
      else if (!urls.includes(requested)) { refuse(requested, "requested-section-limit", "Requested-section limit reached (4 per document)."); continue; }
      leads.push({ url: requested, candidateId: id });
      continue;
    }
    if (candidates.size >= MAX_REQUESTED_DOCUMENTS) {
      refuse(requested, "requested-document-limit", "Explicit-original candidate limit reached (8 documents); narrow the source list."); continue;
    }
    leads.push({ url: requested, candidateId: id });
    candidates.set(id, { id, sourceId: id, sourceKind: "public-reference", name: canonical,
      description: "User-supplied original URL with unobserved contents; no official authorship or document contents established. Consider this original independently of search results. No creator payment.",
      tags: ["public-web", "requested-source"], fetchPrice: 0, cached: false, preview: "No document text has been read. Only a bounded whole document is supported, not section-specific extraction.",
      item: { sourceKind: "public-reference", itemId: digest(canonical), itemTitle: canonical, itemUrl: canonical,
        contentVersion: "unread", requestedSource: { urls: [requested], readScope: "bounded-whole-document" } } });
  }
  if (supplied.omitted) notices.push({ url: "Additional supplied URLs", reason: `${supplied.omitted} additional recognized URL leads withheld by the eight-lead limit; narrow the source list.` });
  if (supplied.questionTruncated || supplied.scanTruncated) {
    notices.push({ url: "Additional supplied URLs", reason: "Question/URL scan limit reached (30000 characters, 16 URLs); unscanned URLs were not admitted." });
  }
  return { candidates, notices, leads, omitted: supplied.omitted };
}
