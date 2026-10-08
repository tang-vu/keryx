import { fetchPublicBytes } from "../net/public-fetch";
import { normalizeVersionedArxivId } from "../scholarly/arxiv-identity";
import { normalizeDoi } from "../scholarly/doi";
import { bibliographicOriginalUrl, type BibliographicOriginalReader } from "./bibliographic-original";
import { BibliographicOriginalError } from "./bibliographic-original-types";

/** Exact metadata URLs only; no arbitrary publisher URL, redirect substitution,
 * search, full-paper extraction, shared database write or paid supplier. */
export const readBibliographicOriginalBody: BibliographicOriginalReader = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("Metadata read cancelled", "AbortError");
  let mediaType: "text/html" | "application/json";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) throw new Error();
    const arxiv = parsed.hostname === "arxiv.org" && parsed.pathname.startsWith("/abs/") ? normalizeVersionedArxivId(parsed.pathname.slice(5)) : undefined;
    const doi = parsed.hostname === "api.crossref.org" && parsed.pathname.startsWith("/works/") ? normalizeDoi(decodeURIComponent(parsed.pathname.slice(7))) : undefined;
    if (!arxiv && !doi || url !== bibliographicOriginalUrl({ scope: "metadata-only", language: "en", target: arxiv ? { kind: "arxiv", id: arxiv } : { kind: "doi", doi: doi! } })) throw new Error();
    mediaType = arxiv ? "text/html" : "application/json";
  } catch { throw new BibliographicOriginalError("invalid-metadata-read"); }
  const fetched = await fetchPublicBytes(url, { maxBytes: 250000, timeoutMs: 8000, maxHops: 0, signal,
    httpsOnly: true, allowedContentTypes: [mediaType] });
  if (fetched.finalUrl !== url) throw new BibliographicOriginalError("document-identity-changed");
  if (fetched.contentType !== mediaType || fetched.bytes.length > 250000) throw new BibliographicOriginalError("invalid-metadata-read");
  const body = new TextDecoder("utf-8", { fatal: true }).decode(fetched.bytes);
  return { requestedUrl: url, finalUrl: fetched.finalUrl, observedAt: new Date().toISOString(), mediaType, body, truncated: false };
};
