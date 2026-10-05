import { canonicalUrl } from "./url-identity";
import type { SearchProvider } from "./search-provider";
import { reserveBoundedSearch } from "../research/research-allowance";

/** Fixed vendor endpoint; secrets stay in the server header, never URLs or public errors. */
export function tavilyProvider(apiKey: string): SearchProvider {
  if (!apiKey.trim()) throw new Error("Search provider is unconfigured");
  return { async search(query, signal) {
    const boundedQuery = query.slice(0, 500);
    // Other callers cannot consume the dated shared allowance without an admitted question.
    reserveBoundedSearch(boundedQuery);
    const boundedSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(6000)]);
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST", redirect: "error", signal: boundedSignal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: boundedQuery, search_depth: "basic", topic: "general",
          auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false, max_results: 10 }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Search unavailable"); }
      const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 250000) { await reader.cancel(); throw new Error("Search response exceeds limit"); } chunks.push(part.value); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!value || typeof value !== "object" || !Array.isArray((value as { results?: unknown }).results)) throw new Error("Invalid search response");
      return (value as { results: unknown[] }).results.slice(0, 10).flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const hit = item as Record<string, unknown>, url = typeof hit.url === "string" ? canonicalUrl(hit.url) : null;
        if (!url || typeof hit.title !== "string") return [];
        return [{ url, title: hit.title.slice(0, 200), snippet: typeof hit.content === "string" ? hit.content.slice(0, 600) : "" }];
      });
    } catch {
      if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
      throw new Error("Search provider unavailable");
    }
  } };
}
