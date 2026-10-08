import { fetchPublicBytes, UnsafeTargetError } from "../net/public-fetch";
import { extractPdfText } from "./pdf-reader";
import { extractHtml } from "./html-reader";
import { bodyIdentity, canonicalUrl, digest, publisherGroup } from "./url-identity";
import type { GatheredContent } from "../llm";
import { observedHtmlTextLayout, type HtmlTextLayout } from "./html-text-layout";

export interface ArticleRead { text: string; title: string; finalUrl: string; kind: "html" | "text" | "pdf"; truncated: boolean; htmlTextLayout?: HtmlTextLayout }
export type ArticleFailureCode = "invalid-url" | "document-identity-changed" | "publisher-verification-required" | "transport-unavailable" | "article-byte-limit" | "html-extraction-unavailable" | "pdf-extraction-unavailable" | "cancelled";
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
  if (contentType === "text/plain" || contentType === "text/markdown") return { text: text.slice(0, 60000), title: new URL(finalUrl).hostname, finalUrl, kind: "text", truncated: text.length > 60000 };
  throw new Error("Unsupported direct extraction");
}
export const readArticle: ArticleReader = async (url, signal) => {
  if (!canonicalUrl(url)) throw new ArticleReadError("invalid-url");
  const fetched = await fetchPublicBytes(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000, maxHops: 3, signal,
    httpsOnly: true, allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/pdf"] }).catch(error => {
      throw new ArticleReadError(signal?.aborted ? "cancelled" : error instanceof UnsafeTargetError && error.message === "that file is too large to read" ? "article-byte-limit" : "transport-unavailable");
    });
    // OpenReview can return a successful HTML response at this verification route.
    // Its instructions are an access failure, never text from the requested paper.
    const finalLocation = new URL(fetched.finalUrl);
    if (finalLocation.hostname === "openreview.net" && /^\/challenge\/?$/u.test(finalLocation.pathname)) {
      throw new ArticleReadError("publisher-verification-required");
    }
    if (fetched.contentType === "application/pdf") {
      const result = await extractPdfText(fetched.bytes, { signal, maxPages: 20, maxChars: 60000, timeoutMs: 5000 }).catch(() => { throw new ArticleReadError(signal?.aborted ? "cancelled" : "pdf-extraction-unavailable"); });
      return { text: result.text, title: new URL(fetched.finalUrl).hostname, finalUrl: fetched.finalUrl, kind: "pdf", truncated: result.truncated };
    }
    // Plain formats keep their byte cap. HTML now applies that same cap after
    // inert markup normalization inside the bounded worker, not to JS payloads.
    if (fetched.bytes.length > 500000 && (fetched.contentType === "text/plain" || fetched.contentType === "text/markdown")) throw new ArticleReadError("article-byte-limit");
    const text = new TextDecoder().decode(fetched.bytes);
    return fetched.contentType === "text/plain" || fetched.contentType === "text/markdown" ? extractArticle(text, fetched.finalUrl, fetched.contentType) : await extractHtml(text, fetched.finalUrl, signal).catch(() => { throw new ArticleReadError(signal?.aborted ? "cancelled" : "html-extraction-unavailable"); });
};
export function gatheredArticle(id: string, article: ArticleRead): GatheredContent {
  const finalUrl = canonicalUrl(article.finalUrl);
  if (!finalUrl) throw new Error("Invalid article provenance");
  const layout = article.kind === "html" ? observedHtmlTextLayout(article.text, article.htmlTextLayout) : undefined;
  return { assetId: id, sourceId: id, sourceName: publisherGroup(finalUrl), sourceKind: "public-reference",
    publicDeliveryKind: "excerpt", itemId: digest(finalUrl), itemTitle: article.title, itemUrl: finalUrl,
    contentVersion: digest(article.text), marker: "", text: article.text,
    ...(layout ? { htmlTextLayout: layout } : {}),
    webProvenance: { retrievedAt: new Date().toISOString(), publisherGroup: publisherGroup(article.finalUrl),
      normalizedBodyHash: bodyIdentity(article.text), extraction: article.kind, truncated: article.truncated } };
}
