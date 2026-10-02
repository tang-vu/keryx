import { fetchPublicDocument } from "../net/public-fetch";
import { canonicalUrl } from "./url-identity";

export interface SearchHit { url: string; title: string; snippet: string }
export interface SearchProvider { search(query: string, signal?: AbortSignal): Promise<SearchHit[]> }

/** Trusted server configuration only; never accept this endpoint from a research request. */
export function searxngProvider(endpoint: string): SearchProvider {
  const base = new URL(endpoint);
  const local = base.protocol === "http:" && base.hostname === "127.0.0.1" && !!base.port;
  if ((!local && base.protocol !== "https:") || base.username || base.password || base.search || base.hash)
    throw new Error("Invalid trusted search endpoint");
  return { async search(query, signal) {
    const url = new URL(base); url.searchParams.set("q", query.slice(0, 500));
    url.searchParams.set("format", "json"); url.searchParams.set("categories", "general");
    // Loopback exception is restricted to this immutable operator-owned service. No redirects.
    let body: string;
    if (local) {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(6000)]) });
      if (!response.ok) throw new Error("Search unavailable");
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 250000) { await reader.cancel(); throw new Error("Search response exceeds limit"); } chunks.push(part.value); }
      body = Buffer.concat(chunks).toString("utf8");
    } else body = (await fetchPublicDocument(url.href, { maxBytes: 250000, timeoutMs: 6000, maxHops: 0, signal,
      allowedContentTypes: ["application/json"] })).text;
    const json: unknown = JSON.parse(body);
    if (!json || typeof json !== "object" || !Array.isArray((json as { results?: unknown }).results)) throw new Error("Invalid search response");
    return ((json as { results: unknown[] }).results).slice(0, 40).flatMap(value => {
      if (!value || typeof value !== "object") return [];
      const hit = value as Record<string, unknown>; const canonical = typeof hit.url === "string" ? canonicalUrl(hit.url) : null;
      if (!canonical || typeof hit.title !== "string") return [];
      return [{ url: canonical, title: hit.title.slice(0, 200), snippet: typeof hit.content === "string" ? hit.content.slice(0, 600) : "" }];
    });
  } };
}
