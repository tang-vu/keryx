import type { SourceCandidate } from "../llm";
import { canonicalUrl, digest } from "./url-identity";

export const MAX_REQUESTED_DOCUMENTS = 4;
const MAX_URL_CHARS = 2048;
const MAX_SCANNED_URLS = 16;

export interface RequestedSourceNotice { url: string; reason: string }

function trimLink(raw: string): string {
  let value = raw.replace(/[.,;!?]+$/u, "");
  for (const [open, close] of [["(", ")"], ["[", "]"]]) {
    while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
  }
  return value;
}

/** Admission is local and bounded. Every actual read still uses the public-only reader.
 * A supplied URL is a request constraint, never a content preview or payout authority. */
export function requestedSources(question: string) {
  const candidates = new Map<string, SourceCandidate>();
  const notices: RequestedSourceNotice[] = [];
  let scanned = 0;
  for (const match of question.slice(0, 30000).matchAll(/https?:\/\/[^\s<>"`]+/giu)) {
    if (++scanned > MAX_SCANNED_URLS) {
      notices.push({ url: "Additional supplied URLs", reason: "URL scan limit reached (16); narrow the source list." });
      break;
    }
    const raw = trimLink(match[0]);
    let url: URL;
    try { url = new URL(raw); } catch {
      notices.push({ url: "Invalid supplied URL", reason: "invalid-url" }); continue;
    }
    // Do not echo credentials into trace metadata, even for a refused URL.
    if (url.username || url.password) {
      notices.push({ url: "Credential-bearing supplied URL", reason: "Credentials in document URLs are refused." }); continue;
    }
    if (raw.length > MAX_URL_CHARS) {
      notices.push({ url: `${url.origin}/…`, reason: "URL exceeds the 2048-character limit." }); continue;
    }
    const canonical = canonicalUrl(raw);
    if (!canonical) {
      notices.push({ url: raw, reason: url.protocol === "http:" ? "The document reader requires HTTPS; no HTTP read or inferred replacement was attempted." : "invalid-url" }); continue;
    }
    const requested = canonical + url.hash;
    const id = `public:web:${digest(canonical)}`;
    const existing = candidates.get(id);
    if (existing?.item?.requestedSource) {
      const urls = existing.item.requestedSource.urls;
      if (!urls.includes(requested) && urls.length < MAX_REQUESTED_DOCUMENTS) urls.push(requested);
      else if (!urls.includes(requested)) notices.push({ url: requested, reason: "Requested-section limit reached (4 per document)." });
      continue;
    }
    if (candidates.size >= MAX_REQUESTED_DOCUMENTS) {
      notices.push({ url: requested, reason: "Explicit-original candidate limit reached (4 documents); narrow the source list." }); continue;
    }
    candidates.set(id, { id, sourceId: id, sourceKind: "public-reference", name: canonical,
      description: "User-supplied original URL. Its contents and authority are unobserved; consider this original independently of search results. No creator payment.",
      tags: ["public-web", "requested-original"], fetchPrice: 0, cached: false, preview: "No document text has been read.",
      item: { sourceKind: "public-reference", itemId: digest(canonical), itemTitle: canonical, itemUrl: canonical,
        contentVersion: "unread", requestedSource: { urls: [requested], readScope: "bounded-whole-document" } } });
  }
  return { candidates, notices };
}
