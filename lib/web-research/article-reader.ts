import { fetchPublicBytes, UnsafeTargetError } from "../net/public-fetch";
import { extractPdfText } from "./pdf-reader";
import { unicodePrefix } from "./unicode-prefix-worker.mjs";
import { extractHtml } from "./html-reader";
import { bodyIdentity, canonicalUrl, digest, publisherGroup } from "./url-identity";
import type { GatheredContent } from "../llm";
import { observedHtmlTextLayout, type HtmlTextLayout } from "./html-text-layout";
import { publicFetchFailure, safePublicFetchDiagnostic, type PublicFetchDiagnostic } from "../net/public-fetch-diagnostic";
import { observedPdfTextScope, pdfTextScopeTruncated, type PdfTextScope } from "./pdf-text-scope";
import { observedHtmlSectionScope, type HtmlSectionScope } from "./html-section-scope";

export interface ArticleRead { text: string; title: string; finalUrl: string; kind: "html" | "text" | "pdf"; truncated: boolean; htmlTextLayout?: HtmlTextLayout; pdfTextScope?: PdfTextScope; htmlSectionScope?: HtmlSectionScope }
export type ArticleFailureCode = "invalid-url" | "document-identity-changed" | "publisher-verification-required" | "transport-unavailable" | "article-byte-limit" | "html-extraction-unavailable" | "pdf-extraction-unavailable" | "cancelled";
export class ArticleReadError extends Error {
  readonly diagnostic?: PublicFetchDiagnostic;
  constructor(readonly code: ArticleFailureCode, diagnostic?: PublicFetchDiagnostic) {
    super(code); this.name = "ArticleReadError";
    this.diagnostic = safePublicFetchDiagnostic(diagnostic);
  }
}
export function articleReadDiagnostic(error: unknown): PublicFetchDiagnostic | undefined {
  return error instanceof ArticleReadError ? safePublicFetchDiagnostic(error.diagnostic) : publicFetchFailure(error);
}
export function articleFailureCode(error: unknown): ArticleFailureCode {
  if (error instanceof ArticleReadError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  return "transport-unavailable";
}
export interface ArticleReadOptions { requestedUrls?: readonly string[] }
export type ArticleReader = (url: string, signal?: AbortSignal, options?: ArticleReadOptions) => Promise<ArticleRead>;

/** Intent is independent of the transport URL: redirects never supply or replace
 * the caller's selector. Mixed whole-document/multiple-section requests retain
 * whole-document mode; never silently select only the first requested section. */
export function requestedHtmlFragment(url: string, options?: ArticleReadOptions): string | undefined {
  const requested = options?.requestedUrls ?? [url];
  if (!requested.length || requested.length > 4) return;
  const fragments = new Set<string>();
  for (const raw of requested) {
    if (canonicalUrl(raw) !== canonicalUrl(url)) throw new ArticleReadError("invalid-url");
    const hash = new URL(raw).hash;
    if (!hash) return;
    try { fragments.add(decodeURIComponent(hash.slice(1))); }
    catch { throw new ArticleReadError("html-extraction-unavailable"); }
  }
  return fragments.size === 1 ? [...fragments][0] : undefined;
}
/** Plain text needs no parser. HTML always uses the isolated worker. */
export function extractArticle(text: string, finalUrl: string, contentType: string): ArticleRead {
  if (contentType === "text/plain" || contentType === "text/markdown") return { text: unicodePrefix(text, 60000), title: new URL(finalUrl).hostname, finalUrl, kind: "text", truncated: text.length > 60000 };
  throw new Error("Unsupported direct extraction");
}
export const readArticle: ArticleReader = async (url, signal, options) => {
  if (!canonicalUrl(url)) throw new ArticleReadError("invalid-url");
  const fragment = requestedHtmlFragment(url, options);
  const fetched = await fetchPublicBytes(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000, maxHops: 3, signal,
    representation: "article", httpsOnly: true, allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/pdf"] }).catch(error => {
      throw new ArticleReadError(signal?.aborted ? "cancelled" : error instanceof UnsafeTargetError && error.message === "that file is too large to read" ? "article-byte-limit" : "transport-unavailable", publicFetchFailure(error));
    });
    // OpenReview can return a successful HTML response at this verification route.
    // Its instructions are an access failure, never text from the requested paper.
    const finalLocation = new URL(fetched.finalUrl);
    if (finalLocation.hostname === "openreview.net" && /^\/challenge\/?$/u.test(finalLocation.pathname)) {
      throw new ArticleReadError("publisher-verification-required");
    }
    if (fetched.contentType === "application/pdf") {
      const result = await extractPdfText(fetched.bytes, { signal, maxPages: 20, maxChars: 60000, timeoutMs: 5000 }).catch(() => { throw new ArticleReadError(signal?.aborted ? "cancelled" : "pdf-extraction-unavailable"); });
      return { text: result.text, title: new URL(fetched.finalUrl).hostname, finalUrl: fetched.finalUrl, kind: "pdf", truncated: result.truncated,
        pdfTextScope: { format: "keryx-pdf-text-scope-v1", pagesRead: result.pagesRead, totalPages: result.totalPages,
          pagesWithoutText: result.pagesWithoutText, textLimitReached: result.textLimitReached } };
    }
    // Plain formats keep their byte cap. HTML now applies that same cap after
    // inert markup normalization inside the bounded worker, not to JS payloads.
    if (fetched.bytes.length > 500000 && (fetched.contentType === "text/plain" || fetched.contentType === "text/markdown")) throw new ArticleReadError("article-byte-limit");
    const text = new TextDecoder().decode(fetched.bytes);
    return fetched.contentType === "text/plain" || fetched.contentType === "text/markdown" ? extractArticle(text, fetched.finalUrl, fetched.contentType) : await extractHtml(text, fetched.finalUrl, signal, fragment).catch(() => { throw new ArticleReadError(signal?.aborted ? "cancelled" : "html-extraction-unavailable"); });
};
export function gatheredArticle(id: string, article: ArticleRead): GatheredContent {
  const finalUrl = canonicalUrl(article.finalUrl);
  if (!finalUrl) throw new Error("Invalid article provenance");
  const layout = article.kind === "html" ? observedHtmlTextLayout(article.text, article.htmlTextLayout) : undefined;
  const pdfTextScope = article.kind === "pdf" ? observedPdfTextScope(article.pdfTextScope) : undefined;
  const htmlSectionScope = article.kind === "html" ? observedHtmlSectionScope(article.htmlSectionScope) : undefined;
  if (article.htmlSectionScope !== undefined && (!htmlSectionScope || !article.truncated)) throw new Error("Invalid section provenance");
  return { assetId: id, sourceId: id, sourceName: publisherGroup(finalUrl), sourceKind: "public-reference",
    publicDeliveryKind: "excerpt", itemId: digest(finalUrl), itemTitle: article.title, itemUrl: finalUrl,
    contentVersion: digest(article.text), marker: "", text: article.text,
    ...(layout ? { htmlTextLayout: layout } : {}),
    webProvenance: { retrievedAt: new Date().toISOString(), publisherGroup: publisherGroup(article.finalUrl),
      normalizedBodyHash: bodyIdentity(article.text), extraction: article.kind,
      truncated: article.truncated || Boolean(pdfTextScope && pdfTextScopeTruncated(pdfTextScope)),
      ...(pdfTextScope ? { pdfTextScope } : {}), ...(htmlSectionScope ? { htmlSectionScope } : {}) } };
}
