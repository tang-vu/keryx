import { canonicalUrl } from "../web-research/url-identity";

interface DocumentCandidate {
  assetId?: string;
  sourceId: string;
  itemUrl?: string;
}

/**
 * A conservative attention grouping, never proof of identical bytes, creator ownership or payout
 * authority. Keep meaningful query parameters and versioned paths; normalize only the existing
 * public-reader URL rules (fragments, tracking parameters, host and query order).
 */
export function documentSelectionKey(candidate: DocumentCandidate): string {
  const url = candidate.itemUrl && canonicalUrl(candidate.itemUrl);
  return url ? `url:${url}` : `asset:${candidate.assetId ?? candidate.sourceId}`;
}

/** An already gathered location cannot be read as independent corroboration through another ID. */
export function documentAlreadyRead(
  candidate: DocumentCandidate,
  gathered: readonly DocumentCandidate[],
): boolean {
  const key = documentSelectionKey(candidate);
  return gathered.some(read => documentSelectionKey(read) === key);
}
