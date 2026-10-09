import type { SupabaseClient } from "@supabase/supabase-js";
import { profileWallet, type PrivateProfilesStore } from "../profiles/private-profile";
import { ProfileIdentityError, identityChallengeSchema, identityProviderSchema, identityRecordSchema, identitySnapshotSchema,
  providerIdentitySchema, type IdentityChallenge, type ProfileIdentitiesStore } from "../profiles/verified-identities";

/** Ordinary private-profile capability only. Missing RPC or migration refuses; never REST fallback. */
export function createSupabaseProfileIdentities(client: SupabaseClient, privateProfiles: PrivateProfilesStore): ProfileIdentitiesStore {
  if (!privateProfiles) throw new ProfileIdentityError("identity_unavailable");
  const call = async (operation: string, args: Record<string, unknown>) => {
    try {
      const { data, error } = await client.rpc(operation, args);
      if (error) {
        if (error.code === "23505" && error.message?.includes("profile_verified_identities_provider_external_id_key"))
          throw new ProfileIdentityError("identity_conflict");
        if (error.code === "P0001" && ["identity_expired", "profile_required"].includes(error.message))
          throw new ProfileIdentityError(error.message as "identity_expired" | "profile_required");
        throw new ProfileIdentityError("identity_unavailable");
      }
      return data;
    } catch (error) { if (error instanceof ProfileIdentityError) throw error; throw new ProfileIdentityError("identity_unavailable"); }
  };
  const parse = <T>(value: unknown, parser: { parse(value: unknown): T }): T => {
    try { return parser.parse(value); } catch { throw new ProfileIdentityError("identity_unavailable"); }
  };
  const args = (challenge: IdentityChallenge) => ({ p_wallet: challenge.wallet, p_provider: challenge.provider,
    p_state_hash: challenge.stateHash, p_session_hash: challenge.sessionHash, p_expires_at: challenge.expiresAt });
  const ack = (value: unknown, key: string) => {
    if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || Reflect.get(value, key) !== true)
      throw new ProfileIdentityError("identity_unavailable");
  };
  return Object.freeze({
    async list(owner) {
      const wallet = profileWallet(owner), result = parse(await call("profile_identities_list_v1", { p_wallet: wallet }), identitySnapshotSchema);
      if (result.wallet !== wallet) throw new ProfileIdentityError("identity_unavailable");
      return result;
    },
    async begin(raw) { const challenge = identityChallengeSchema.parse(raw); ack(await call("profile_identity_begin_v1", args(challenge)), "begun"); },
    async consume(raw) { const challenge = identityChallengeSchema.parse(raw); ack(await call("profile_identity_consume_v1", args(challenge)), "consumed"); },
    async complete(raw, rawIdentity) {
      const challenge = identityChallengeSchema.parse(raw), identity = providerIdentitySchema.parse(rawIdentity);
      if (identity.provider !== challenge.provider) throw new ProfileIdentityError("identity_expired");
      const result = parse(await call("profile_identity_complete_v1", { ...args(challenge), p_identity: identity }), identityRecordSchema);
      if (result.wallet !== challenge.wallet || result.provider !== identity.provider || result.externalId !== identity.externalId || result.label !== identity.label)
        throw new ProfileIdentityError("identity_unavailable");
      return result;
    },
    async unlink(owner, rawProvider) {
      ack(await call("profile_identity_unlink_v1", { p_wallet: profileWallet(owner), p_provider: identityProviderSchema.parse(rawProvider) }), "unlinked");
    },
  } satisfies ProfileIdentitiesStore);
}
