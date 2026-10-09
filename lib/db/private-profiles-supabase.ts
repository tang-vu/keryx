import type { SupabaseClient } from "@supabase/supabase-js";
import { PrivateProfileError, privateProfileInputSchema, privateProfileRecordSchema, privateProfileSnapshotSchema, profileWallet, type PrivateProfilesStore } from "../profiles/private-profile";

/** RPC-only ordinary domain: missing migration or any unavailable result refuses. No REST fallback. */
export function createSupabasePrivateProfiles(client: SupabaseClient): PrivateProfilesStore {
  const call = async (operation: string, args: Record<string, unknown>) => {
    try {
      const { data, error } = await client.rpc(operation, args);
      if (error) {
        if (error.code === "23505" && error.message?.includes("private_profiles_handle_key")) throw new PrivateProfileError("handle_conflict");
        throw new PrivateProfileError("profile_unavailable");
      }
      return data;
    } catch (error) { if (error instanceof PrivateProfileError) throw error; throw new PrivateProfileError("profile_unavailable"); }
  };
  const parse = <T>(body: unknown, parser: { parse(value: unknown): T }): T => {
    try { return parser.parse(body); } catch { throw new PrivateProfileError("profile_unavailable"); }
  };
  return Object.freeze({
    async get(owner, network) {
      const wallet = profileWallet(owner);
      if (network !== "eip155:5042" && network !== "eip155:5042002") throw new PrivateProfileError("profile_unavailable");
      const result = parse(await call("private_profile_get_v1", { p_wallet: wallet, p_network: network }), privateProfileSnapshotSchema);
      if (result.profile && result.profile.wallet !== wallet || result.activity.network !== network) throw new PrivateProfileError("profile_unavailable");
      return result;
    },
    async update(owner, raw) {
      const wallet = profileWallet(owner), input = privateProfileInputSchema.parse(raw);
      const result = parse(await call("private_profile_update_v1", { p_wallet: wallet, p_profile: input }), privateProfileRecordSchema);
      if (result.wallet !== wallet || result.handle !== input.handle || result.displayName !== input.displayName
        || result.bio !== input.bio || result.purpose !== input.purpose || JSON.stringify(result.links) !== JSON.stringify(input.links)) throw new PrivateProfileError("profile_unavailable");
      return result;
    },
    async delete(owner) {
      const result = await call("private_profile_delete_v1", { p_wallet: profileWallet(owner) });
      if (!result || typeof result !== "object" || result.deleted !== true || Object.keys(result).length !== 1) throw new PrivateProfileError("profile_unavailable");
    },
  } satisfies PrivateProfilesStore);
}
