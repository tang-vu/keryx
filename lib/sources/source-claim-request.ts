import type { SourceClaimReceipt } from "../types";
import { sourceClaimReceiptSchema } from "./public-source-claim";
export { sourceClaimReceiptSchema } from "./public-source-claim";

/** Browser-safe policy identity, retained alongside the original authorization. */
export function sameSourceClaim(a: SourceClaimReceipt, b: SourceClaimReceipt): boolean {
  return a.id === b.id && a.revision === b.revision && a.mode === b.mode &&
    a.effectiveAt === b.effectiveAt && a.verifiedAt === b.verifiedAt;
}

export function sourceClaimPath(path: string, claim?: SourceClaimReceipt): string {
  if (!claim) return path;
  sourceClaimReceiptSchema.parse(claim);
  const url = new URL(path, "https://keryx.invalid");
  url.searchParams.set("claimId", claim.id);
  url.searchParams.set("claimRevision", String(claim.revision));
  return `${url.pathname}${url.search}`;
}

/** Both fields are required for a new paid request to a claim-managed source. */
export function assertSourceClaimRequest(params: URLSearchParams, current?: SourceClaimReceipt): void {
  const ids = params.getAll("claimId"), revisions = params.getAll("claimRevision");
  if (!current && ids.length === 0 && revisions.length === 0) return;
  if (!current || ids.length !== 1 || revisions.length !== 1 || ids[0] !== current.id ||
      revisions[0] !== String(current.revision)) throw new Error("Source claim changed; rediscover before paying");
}
