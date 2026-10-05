import type { KeryxDB } from "../db/keryx-db";
import type { Source, SourceClaimReceipt } from "../types";
import type { SourceFetchTerms } from "../registry/source-fetch-payto";
import { config } from "../config";
import { canonicalSourceUrl, SOURCE_CLAIM_PROOF_MAX_AGE_MS, type SourceClaim } from "./public-source-claim";
import { sourceClaimPolicyForSource } from "./public-source-claim-service";
import { sameSourceClaim } from "./source-claim-request";
export { sameSourceClaim } from "./source-claim-request";

export interface SourceClaimAccess {
  claim: SourceClaim | null;
  snapshot?: SourceClaimReceipt;
  readAllowed: boolean;
  rewardAllowed: boolean;
}

export function sourceClaimReceipt(claim: SourceClaim): SourceClaimReceipt {
  return { id: claim.id, revision: claim.revision, mode: claim.mode,
    effectiveAt: claim.effectiveAt, verifiedAt: claim.verifiedAt };
}

/** The retained link selects the policy; caller/model metadata cannot enroll or activate it. */
export async function sourceClaimAccess(
  db: KeryxDB, source: Source, terms: SourceFetchTerms,
  options: { expected?: SourceClaimReceipt | null; now?: number } = {},
): Promise<SourceClaimAccess> {
  const claim = await sourceClaimPolicyForSource(db, source.id);
  if (source.sourceClaimId && (!claim || claim.id !== source.sourceClaimId))
    throw new Error("The source's retained claim policy is unavailable");
  if (!claim) {
    if (options.expected) throw new Error("Source claim changed after discovery");
    return { claim: null, readAllowed: true, rewardAllowed: true };
  }
  const now = options.now ?? Date.now();
  const verified = Date.parse(claim.verifiedAt), effective = Date.parse(claim.effectiveAt);
  if (claim.linkedSourceId !== source.id || claim.onchainId?.toLowerCase() !== source.onchainId?.toLowerCase() ||
      canonicalSourceUrl(source.url) !== claim.canonicalUrl || claim.network !== config.networkId ||
      terms.authority !== "onchain" || terms.stale || !terms.active || terms.creator.toLowerCase() !== claim.ownerWallet ||
      !Number.isFinite(verified) || verified > now || now - verified > SOURCE_CLAIM_PROOF_MAX_AGE_MS ||
      !Number.isFinite(effective) || effective > now)
    throw new Error("Current verified source claim authority is unavailable");
  const snapshot = sourceClaimReceipt(claim);
  if ("expected" in options && (!options.expected || !sameSourceClaim(snapshot, options.expected)))
    throw new Error("Source claim changed after discovery; no new payment is authorized");
  const enabled = claim.mode !== "free" && claim.distributionPermission;
  const compatiblePrice = claim.mode === "paid" ? terms.listPriceUsdc > 0 : terms.listPriceUsdc === 0;
  return { claim, snapshot, readAllowed: compatiblePrice && (claim.mode === "free" || enabled),
    rewardAllowed: compatiblePrice && enabled };
}

/** Compare exact already-readable bytes and canonical locations, never previews or just titles. */
export function publicDuplicateOfOwnedItem(
  item: { link: string; bodyHash?: string; content: string; storageMode?: string; ipfsCid?: string },
  publicRead: { itemUrl?: string; text: string },
  hash: (text: string) => string,
): boolean {
  try {
    if (!publicRead.itemUrl || canonicalSourceUrl(item.link) !== canonicalSourceUrl(publicRead.itemUrl)) return false;
    const ownedHash = item.bodyHash ?? (!item.ipfsCid && item.storageMode !== "db_encrypted" ? hash(item.content) : undefined);
    return Boolean(ownedHash && ownedHash === hash(publicRead.text));
  } catch { return false; }
}
