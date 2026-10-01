import { fetchPublicBytes } from "../net/public-fetch";
import { extractPdfText } from "./pdf-reader";
import { extractHtml } from "./html-reader";
import { bodyIdentity, canonicalUrl, digest, publisherGroup } from "./url-identity";
import type { GatheredContent } from "../llm";

export interface ArticleRead { text: string; title: string; finalUrl: string; kind: "html" | "text" | "pdf"; truncated: boolean }
export type ArticleFailureCode = "invalid-url" | "transport-unavailable" | "article-byte-limit" | "html-extraction-unavailable" | "pdf-extraction-unavailable" | "cancelled";
export class ArticleReadError extends Error {
  constructor(readonly code: ArticleFailureCode) { super(code); this.name = "ArticleReadError"; }
}
export function articleFailureCode(error: unknown): ArticleFailureCode {
  if (error instanceof ArticleReadError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  return "transport-unavailable";
}
export type ArticleReader = (url: string, signal?: AbortSignal) => Promise<ArticleRead>;
/** Plain text needs no parser. HTML always uses the isolated worker. */
export function extractArticle(text: string, finalUrl: string, contentType: string): ArticleRead {
  if (contentType === "text/plain") return { text: text.slice(0, 60000), title: new URL(finalUrl).hostname, finalUrl, kind: "text", truncated: text.length > 60000 };
  throw new Error("Unsupported direct extraction");
}
export const readArticle: ArticleReader = async (url, signal) => {
  if (!canonicalUrl(url)) throw new ArticleReadError("invalid-url");
  const fetched = await fetchPublicBytes(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000, maxHops: 3, signal,
    httpsOnly: true, allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain", "application/pdf"] }).catch(() => { throw new ArticleReadError(signal?.aborted ? "cancelled" : "transport-unavailable"); });
    if (fetched.contentType === "application/pdf") {
      const result = await extractPdfText(fetched.bytes, { signal, maxPages: 20, maxChars: 60000, timeoutMs: 5000 }).catch(() => { throw new ArticleReadError(signal?.aborted ? "cancelled" : "pdf-extraction-unavailable"); });
      return { text: result.text, title: new URL(fetched.finalUrl).hostname, finalUrl: fetched.finalUrl, kind: "pdf", truncated: result.truncated };
    }
    if (fetched.bytes.length > 500000) throw new ArticleReadError("article-byte-limit");
    const text = new TextDecoder().decode(fetched.bytes);
    return fetched.contentType === "text/plain" ? extractArticle(text, fetched.finalUrl, fetched.contentType) : await extractHtml(text, fetched.finalUrl, signal).catch(() => { throw new ArticleReadError(signal?.aborted ? "cancelled" : "html-extraction-unavailable"); });
};
export function gatheredArticle(id: string, article: ArticleRead): GatheredContent {
  const finalUrl = canonicalUrl(article.finalUrl);
  if (!finalUrl) throw new Error("Invalid article provenance");
  return { assetId: id, sourceId: id, sourceName: publisherGroup(finalUrl), sourceKind: "public-reference",
    publicDeliveryKind: "excerpt", itemId: digest(finalUrl), itemTitle: article.title, itemUrl: finalUrl,
    contentVersion: digest(article.text), marker: "", text: article.text,
    webProvenance: { retrievedAt: new Date().toISOString(), publisherGroup: publisherGroup(article.finalUrl),
      normalizedBodyHash: bodyIdentity(article.text), extraction: article.kind, truncated: article.truncated } };
}
