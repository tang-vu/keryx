import type { BibliographicOriginalRequest } from "./bibliographic-original-types";

/** Canonical public metadata identity, usable by server and portable consumers. */
export function bibliographicOriginalUrl(request: BibliographicOriginalRequest) {
  return request.target.kind === "arxiv" ? `https://arxiv.org/abs/${request.target.id}` : `https://api.crossref.org/works/${encodeURIComponent(request.target.doi)}`;
}
