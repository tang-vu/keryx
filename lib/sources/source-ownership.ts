/**
 * Who owns a source.
 *
 * A wallet owns a source when it is the source's payout wallet or one of its author wallets —
 * the same rule the owner-gated profile panels (preview depth, citation webhook) enforce. Kept
 * in one place so a widened definition can never apply to one surface and not another.
 *
 * Note what is deliberately NOT ownership: having received a payment from a source. Payout rows
 * record where money went, so treating them as a claim would let anyone who ever took a split
 * read the source's whole history.
 */

import type { Source } from "../types";

export function ownsSource(source: Source, address: string): boolean {
  const addr = address.toLowerCase();
  return (
    source.walletAddress.toLowerCase() === addr ||
    source.authors.some((a) => a.walletAddress.toLowerCase() === addr)
  );
}

export function sourcesOwnedBy(sources: Source[], address: string): Source[] {
  return sources.filter((s) => ownsSource(s, address));
}
