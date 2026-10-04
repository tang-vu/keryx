import type { KeryxDB } from "../db/keryx-db";
import { config } from "../config";
import { getRegistrySource, sourceId as registrySourceId } from "../registry/registry-client";
import { publicSourceClaimId, SourceClaimError } from "../db/public-source-claims";
import { canonicalSourceUrl, claimControlIsFresh, type SourceClaim, type SourceClaimMode } from "./public-source-claim";
import type { Source } from "../types";

export function assertSourceClaimScope(claim: Pick<SourceClaim, "network" | "deploymentOrigin"> & { registryAddress?: string }): void {
  if (claim.network !== config.networkId || claim.deploymentOrigin !== new URL(config.baseUrl).origin)
    throw new SourceClaimError("Source claim belongs to another network or deployment", 409, "claim_scope_mismatch");
  if (claim.registryAddress && claim.registryAddress !== config.registryReadAddress?.toLowerCase())
    throw new SourceClaimError("Source claim belongs to another registry; explicit migration is required", 409, "claim_registry_mismatch");
}
export async function sourceClaimPolicyForSource(db: KeryxDB, sourceId: string): Promise<SourceClaim | null> {
  if (!db.getSourceClaimForSource) return null;
  const claim = await db.getSourceClaimForSource(sourceId);
  if (claim) { assertSourceClaimScope(claim); if (claim.linkedSourceId !== sourceId) throw new SourceClaimError("Claim source binding differs"); }
  return claim;
}
export async function sourceClaimForUrl(db: KeryxDB, canonicalUrl: string): Promise<SourceClaim | null> {
  if (!db.getSourceClaim) throw new SourceClaimError("Source claims are unsupported on this storage backend", 503, "claims_unavailable");
  let normalized;
  try { normalized = canonicalSourceUrl(canonicalUrl); }
  catch { throw new SourceClaimError("Source URL requires credential-free HTTPS", 400, "invalid_source_url"); }
  return db.getSourceClaim(publicSourceClaimId(normalized, new URL(config.baseUrl).origin, config.networkId));
}
export async function reserveSourceClaimRegistration(db: KeryxDB, input: {
  claimId: string; wallet: string; canonicalUrl: string; sourceId: string; onchainId: string;
}): Promise<SourceClaim> {
  if (!db.getSourceClaim || !db.bindSourceClaim) throw new SourceClaimError("Atomic source claim registration is unavailable", 503, "claims_unavailable");
  const claim = await db.getSourceClaim(input.claimId);
  if (!claim || claim.ownerWallet !== input.wallet.toLowerCase()) throw new SourceClaimError("Verify this source with the connected owner wallet first", 403);
  assertSourceClaimScope(claim);
  if (canonicalSourceUrl(input.canonicalUrl) !== claim.canonicalUrl ||
    registrySourceId(input.wallet as `0x${string}`, input.canonicalUrl).toLowerCase() !== input.onchainId.toLowerCase())
    throw new SourceClaimError("Registration differs from the verified exact source URL", 409);
  if (!claimControlIsFresh(claim)) throw new SourceClaimError("Refresh source-control proof before registration", 409, "proof_refresh_required");
  if (!config.registryReadAddress || !config.registryAddress || config.registryReadAddress.toLowerCase() !== config.registryAddress.toLowerCase())
    throw new SourceClaimError("Matching reviewed registry authority is unavailable", 503);
  // This atomic binding comes before register/indexing and installs the free earning gate.
  return db.bindSourceClaim({ claimId: claim.id, wallet: input.wallet, expectedRevision: claim.revision,
    sourceId: input.sourceId, onchainId: input.onchainId, registryAddress: config.registryReadAddress });
}
async function liveClaimSource(db: KeryxDB, claim: SourceClaim, wallet: string, sourceId: string): Promise<{ source: Source; priceMicros: bigint }> {
  assertSourceClaimScope(claim);
  if (claim.ownerWallet !== wallet.toLowerCase()) throw new SourceClaimError("Only the verified source owner may manage the claim", 403);
  const source = await db.getSource(sourceId);
  if (!source || source.active === false || !source.onchainId || source.id.startsWith("public:"))
    throw new SourceClaimError("An active indexed registry listing is required", 409);
  if (source.scholarlyEnrolled || await db.getPaperState?.(source.id))
    throw new SourceClaimError("Scholarly manuscript rights remain a separate gated enrollment", 409, "scholarly_boundary");
  if (canonicalSourceUrl(source.url) !== claim.canonicalUrl || claim.rssUrl && source.rssUrl !== claim.rssUrl)
    throw new SourceClaimError("Registry listing URL/feed differs from the verified source", 409);
  if (!config.registryReadAddress || !config.registryAddress || config.registryReadAddress.toLowerCase() !== config.registryAddress.toLowerCase())
    throw new SourceClaimError("Matching reviewed registry authority is unavailable", 503);
  let record;
  try { record = await getRegistrySource(source.onchainId as `0x${string}`, { timeoutMs: 4000 }); }
  catch { throw new SourceClaimError("Fresh registry authority could not be read; no earnings policy changed", 503, "registry_unavailable"); }
  if (!record?.active || record.creator.toLowerCase() !== wallet.toLowerCase() ||
    registrySourceId(record.creator, source.url).toLowerCase() !== source.onchainId.toLowerCase())
    throw new SourceClaimError("Only this exact source's live registry creator can link or enable earnings", 403);
  return { source, priceMicros: record.fetchPriceUsdc6 };
}
export async function linkPublicSourceClaim(db: KeryxDB, input: { claimId: string; wallet: string; expectedRevision: number; sourceId: string }): Promise<SourceClaim> {
  if (!db.getSourceClaim || !db.bindSourceClaim) throw new SourceClaimError("Atomic source claims are unavailable", 503, "claims_unavailable");
  const claim = await db.getSourceClaim(input.claimId);
  if (!claim) throw new SourceClaimError("Source claim not found", 404);
  const { source } = await liveClaimSource(db, claim, input.wallet, input.sourceId);
  if (!claimControlIsFresh(claim)) throw new SourceClaimError("Refresh source-control proof before linking", 409, "proof_refresh_required");
  const linked = await db.bindSourceClaim({ ...input, onchainId: source.onchainId!, registryAddress: config.registryReadAddress! });
  if (source.verified !== true && !await db.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: source.walletAddress, feedUrl: source.rssUrl || source.url }))
    throw new SourceClaimError("Source changed before strong claim verification could be inherited; the claim stays free", 409);
  return linked;
}
export async function setPublicSourceClaimPolicy(db: KeryxDB, input: {
  claimId: string; wallet: string; expectedRevision: number; mode: SourceClaimMode; distributionPermission: boolean;
}): Promise<SourceClaim> {
  if (!db.getSourceClaim || !db.updateSourceClaimPolicy) throw new SourceClaimError("Atomic source claims are unavailable", 503, "claims_unavailable");
  const claim = await db.getSourceClaim(input.claimId);
  if (!claim) throw new SourceClaimError("Source claim not found", 404);
  assertSourceClaimScope(claim);
  if (claim.ownerWallet !== input.wallet.toLowerCase()) throw new SourceClaimError("Only the source owner may change its policy", 403);
  // Disabling earnings is always available, including during RPC outage or after proof ages out.
  if (input.mode !== "free") {
    if (!claim.linkedSourceId) throw new SourceClaimError("Link the verified source's registry listing first", 409);
    const { priceMicros, source } = await liveClaimSource(db, claim, input.wallet, claim.linkedSourceId);
    if (input.mode === "citation-only" && priceMicros !== BigInt(0) || input.mode === "paid" && priceMicros <= BigInt(0))
      throw new SourceClaimError("Citation-only requires registry read price 0; paid requires a positive owner-set registry price", 409, "price_mode_mismatch");
    if (!claimControlIsFresh(claim)) throw new SourceClaimError("Refresh source-control proof before enabling earnings", 409, "proof_refresh_required");
    if (source.verified !== true && !await db.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: source.walletAddress, feedUrl: source.rssUrl || source.url }))
      throw new SourceClaimError("Source changed before strong claim verification could be inherited; no earnings policy changed", 409);
  }
  return db.updateSourceClaimPolicy(input);
}
