import { z } from "zod";

/** Browser-safe claim contract. A claim never changes a public reference's identity or price. */
export function canonicalSourceUrl(value: string): string {
  if (!value || value.length > 2048) throw new Error("Source URL must be bounded HTTPS");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Source URL requires credential-free HTTPS");
  url.hash = "";
  return url.href;
}
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const url = z.string().max(2048).refine(value => {
  try { return canonicalSourceUrl(value) === value; } catch { return false; }
}, "Canonical HTTPS URL required");
const origin = z.string().max(2048).url().refine(value => new URL(value).origin === value);
export const sourceClaimModeSchema = z.enum(["free", "citation-only", "paid"]);
export type SourceClaimMode = z.infer<typeof sourceClaimModeSchema>;
export const sourceClaimReceiptSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), mode: sourceClaimModeSchema,
  effectiveAt: z.string().datetime(), verifiedAt: z.string().datetime() }).strict();
export const sourceClaimProofMethodSchema = z.enum(["website-file", "rss-channel"]);
export type SourceClaimProofMethod = z.infer<typeof sourceClaimProofMethodSchema>;
export const SOURCE_CLAIM_PROOF_MAX_AGE_MS = 24 * 3600_000;
export const SOURCE_CLAIM_CHALLENGE_TTL_MS = 15 * 60_000;
export function claimControlIsFresh(claim: Pick<SourceClaim, "verifiedAt">, now = Date.now()): boolean {
  const verified = Date.parse(claim.verifiedAt);
  return Number.isFinite(verified) && now >= verified && now - verified <= SOURCE_CLAIM_PROOF_MAX_AGE_MS;
}
export const sourceClaimSchema = z.object({
  id: hash, canonicalUrl: url, rssUrl: url.optional(), publicReferenceId: z.string().max(256).startsWith("public:").optional(),
  ownerWallet: address, deploymentOrigin: origin, network: z.string().regex(/^eip155:\d+$/),
  verifiedAt: z.string().datetime(), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  effectiveAt: z.string().datetime(), mode: sourceClaimModeSchema,
  linkedSourceId: z.string().min(1).max(256).refine(value => !value.startsWith("public:")).optional(),
  onchainId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  registryAddress: address.optional(),
  distributionPermission: z.boolean(), proofMethod: sourceClaimProofMethodSchema.optional(),
}).strict().refine(value => !value.linkedSourceId || Boolean(value.onchainId && value.registryAddress), "Linked claims require retained registry identity");
export type SourceClaim = z.infer<typeof sourceClaimSchema>;
export const sourceClaimChallengeSchema = z.object({
  id: hash, claimId: hash, wallet: address, canonicalUrl: url, rssUrl: url.optional(),
  publicReferenceId: z.string().max(256).startsWith("public:").optional(),
  deploymentOrigin: origin, network: z.string().regex(/^eip155:\d+$/), nonce: hash,
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(), consumedAt: z.string().datetime().optional(),
  proofMethod: sourceClaimProofMethodSchema.optional(),
}).strict();
export type SourceClaimChallenge = z.infer<typeof sourceClaimChallengeSchema>;
export const sourceClaimProofSchema = z.object({
  protocol: z.literal("keryx-source-claim-v1"), challengeId: hash, claimId: hash, wallet: address,
  canonicalUrl: url, rssUrl: url.optional(), deploymentOrigin: origin,
  network: z.string().regex(/^eip155:\d+$/), nonce: hash, expiresAt: z.string().datetime(),
  proofMethod: sourceClaimProofMethodSchema.optional(),
}).strict();
export type SourceClaimProof = z.infer<typeof sourceClaimProofSchema>;
export function sourceClaimProof(challenge: SourceClaimChallenge): SourceClaimProof {
  return sourceClaimProofSchema.parse({ protocol: "keryx-source-claim-v1", challengeId: challenge.id,
    claimId: challenge.claimId, wallet: challenge.wallet, canonicalUrl: challenge.canonicalUrl,
    ...(challenge.rssUrl ? { rssUrl: challenge.rssUrl } : {}), deploymentOrigin: challenge.deploymentOrigin,
    network: challenge.network, nonce: challenge.nonce, expiresAt: challenge.expiresAt,
    proofMethod: challenge.proofMethod ?? "website-file" });
}
export function sourceClaimProofUrl(canonicalUrl: string, rssUrl?: string, method?: SourceClaimProofMethod): string {
  if (method === "rss-channel") {
    if (!rssUrl) throw new Error("RSS channel proof requires an exact feed URL");
    return canonicalSourceUrl(rssUrl);
  }
  return `${new URL(canonicalSourceUrl(canonicalUrl)).origin}/.well-known/keryx-source-claim.json`;
}
export interface IssueSourceClaimChallenge {
  wallet: string; canonicalUrl: string; rssUrl?: string; publicReferenceId?: string;
  deploymentOrigin: string; network: string; now?: number;
  proofMethod?: SourceClaimProofMethod;
}
export interface VerifySourceClaim {
  challengeId: string; wallet: string; proofDigest: string; now?: number;
}
export interface BindSourceClaim {
  claimId: string; wallet: string; expectedRevision: number; sourceId: string; onchainId: string; registryAddress: string; now?: number;
}
export interface UpdateSourceClaimPolicy {
  claimId: string; wallet: string; expectedRevision: number; mode: SourceClaimMode;
  distributionPermission: boolean; now?: number;
}
