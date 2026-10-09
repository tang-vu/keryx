import { z } from "zod";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { profileWallet } from "./private-profile";

export const IDENTITY_PROVIDERS = ["orcid", "github"] as const;
export type IdentityProvider = typeof IDENTITY_PROVIDERS[number];
export const identityProviderSchema = z.enum(IDENTITY_PROVIDERS);
export function validOrcid(value: string): boolean {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value)) return false;
  const digits = value.replaceAll("-", "");
  let total = 0;
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
  const check = (12 - total % 11) % 11;
  return digits[15] === (check === 10 ? "X" : String(check));
}
export const providerIdentitySchema = z.object({
  provider: identityProviderSchema,
  externalId: z.string().max(32),
  label: z.string().max(160).refine(value => isWellFormedUtf16(value) && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)),
}).strict().superRefine((identity, ctx) => {
  if (identity.provider === "orcid" ? !validOrcid(identity.externalId)
    : !/^[1-9]\d{0,19}$/.test(identity.externalId) || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(identity.label)) {
    ctx.addIssue({ code: "custom", message: "Invalid provider identity" });
  }
});
export type ProviderIdentity = z.infer<typeof providerIdentitySchema>;
export const identityRecordSchema = z.object({
  provider: identityProviderSchema, externalId: z.string().max(32), label: z.string().max(160),
  wallet: z.string().regex(/^0x[0-9a-f]{40}$/), verifiedAt: z.string().datetime(),
}).strict().superRefine((value, ctx) => {
  if (!providerIdentitySchema.safeParse({ provider: value.provider, externalId: value.externalId, label: value.label }).success)
    ctx.addIssue({ code: "custom", message: "Invalid verified identity" });
});
export type VerifiedIdentity = z.infer<typeof identityRecordSchema>;
export const identitySnapshotSchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-f]{40}$/), identities: z.array(identityRecordSchema).max(2),
}).strict().superRefine((value, ctx) => {
  if (value.identities.some(identity => identity.wallet !== value.wallet)
    || new Set(value.identities.map(identity => identity.provider)).size !== value.identities.length)
    ctx.addIssue({ code: "custom", message: "Invalid identity owner" });
});
export const identityChallengeSchema = z.object({
  wallet: z.string().transform(profileWallet), provider: identityProviderSchema,
  stateHash: z.string().regex(/^[0-9a-f]{64}$/), sessionHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.string().datetime(),
}).strict();
export type IdentityChallenge = z.infer<typeof identityChallengeSchema>;
export type IdentitySnapshot = z.infer<typeof identitySnapshotSchema>;
export interface ProfileIdentitiesStore {
  list(wallet: string): Promise<IdentitySnapshot>;
  /** Keep existing verification; replace the pending lineage. Require a saved profile and active durable SIWE session. */
  begin(challenge: IdentityChallenge): Promise<void>;
  /** Atomic, session-bound single use. Requires current pending lineage, unexpired challenge and active session. */
  consume(challenge: IdentityChallenge): Promise<void>;
  /** Never recreates an unlinked/deleted row; rechecks lineage, deadline and active session in the write transaction. */
  complete(challenge: IdentityChallenge, identity: ProviderIdentity): Promise<VerifiedIdentity>;
  /** Delete verification and invalidate all pending/in-flight work immediately. */
  unlink(wallet: string, provider: IdentityProvider): Promise<void>;
}
export class ProfileIdentityError extends Error {
  constructor(readonly code: "identity_unavailable" | "identity_conflict" | "identity_expired" | "profile_required") { super(code); }
}
export function requireProfileIdentities(db: { readonly profileIdentities?: ProfileIdentitiesStore }): ProfileIdentitiesStore {
  try { if (db.profileIdentities) return db.profileIdentities; } catch { /* Sealed facades refuse unknown domains before I/O. */ }
  throw new ProfileIdentityError("identity_unavailable");
}
export function identityUrl(identity: Pick<VerifiedIdentity, "provider" | "externalId" | "label">): string {
  return identity.provider === "orcid" ? `https://orcid.org/${identity.externalId}` : `https://github.com/${identity.label}`;
}
