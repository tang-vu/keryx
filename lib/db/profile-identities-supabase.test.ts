import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseProfileIdentities } from "./profile-identities-supabase";
import { createSupabasePrivateProfiles } from "./private-profiles-supabase";
import { assembleAuthorityBoundSupabaseCore } from "./supabase-adapter";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { requireProfileIdentities } from "../profiles/verified-identities";
import type { StorageDeploymentManifest } from "./runtime-storage-config";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const challenge = { wallet: alice, provider: "github" as const, stateHash: "1".repeat(64), sessionHash: "2".repeat(64), expiresAt: "2026-10-09T00:10:00.000Z" };
const identity = { provider: "github" as const, externalId: "12345", label: "Alice" };
const record = { ...identity, wallet: alice, verifiedAt: "2026-10-09T00:00:00.000Z" };
function fixture(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error }), from = vi.fn(() => { throw new Error("REST forbidden"); });
  const client = { rpc, from } as unknown as SupabaseClient;
  return { client, rpc, from, port: createSupabaseProfileIdentities(client, createSupabasePrivateProfiles(client)) };
}
describe("ordinary Supabase private verified-identity RPC port", () => {
  it("binds normalized owners and exact lineage/session/deadline on all RPCs without REST", async () => {
    const f = fixture({ wallet: alice, identities: [record] }); expect(await f.port.list(alice.toUpperCase().replace("0X", "0x"))).toEqual({ wallet: alice, identities: [record] });
    expect(f.rpc).toHaveBeenLastCalledWith("profile_identities_list_v1", { p_wallet: alice });
    const args = { p_wallet: alice, p_provider: "github", p_state_hash: challenge.stateHash, p_session_hash: challenge.sessionHash, p_expires_at: challenge.expiresAt };
    for (const [name, key, call] of [["begin", "begun", () => f.port.begin(challenge)], ["consume", "consumed", () => f.port.consume(challenge)]] as const) {
      f.rpc.mockResolvedValue({ data: { [key]: true }, error: null }); await call(); expect(f.rpc).toHaveBeenLastCalledWith(`profile_identity_${name}_v1`, args);
    }
    f.rpc.mockResolvedValue({ data: record, error: null }); expect(await f.port.complete(challenge, identity)).toEqual(record);
    expect(f.rpc).toHaveBeenLastCalledWith("profile_identity_complete_v1", { ...args, p_identity: identity });
    f.rpc.mockResolvedValue({ data: { unlinked: true }, error: null }); await f.port.unlink(alice, "github");
    expect(f.rpc).toHaveBeenLastCalledWith("profile_identity_unlink_v1", { p_wallet: alice, p_provider: "github" }); expect(f.from).not.toHaveBeenCalled();
  });
  it.each([null, {}, { wallet: bob, identities: [] }, { wallet: alice, identities: [{ ...record, wallet: bob }] }, { wallet: alice, identities: [record, record] }, { wallet: alice, identities: [], token: "secret" }])("refuses malformed/foreign snapshots", async value => {
    const f = fixture(value); await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable"); expect(f.from).not.toHaveBeenCalled();
  });
  it.each([null, {}, { begun: true, secret: "hidden" }, { begun: false }])("refuses malformed write acknowledgements", async value => {
    const f = fixture(value); await expect(f.port.begin(challenge)).rejects.toThrow("identity_unavailable");
    await expect(f.port.consume(challenge)).rejects.toThrow("identity_unavailable"); await expect(f.port.unlink(alice, "github")).rejects.toThrow("identity_unavailable");
  });
  it.each([{ ...record, wallet: bob }, { ...record, externalId: "67890" }, { ...record, label: "Foreign" }, { ...record, verifiedAt: "bad" }, { ...record, code: "secret" }])("refuses foreign or malformed complete receipts", async value => {
    const f = fixture(value); await expect(f.port.complete(challenge, identity)).rejects.toThrow("identity_unavailable");
  });
  it("maps non-identifying expiry/profile/collision errors; unknown/missing RPCs never retry or fall back", async () => {
    const f = fixture(null, { code: "PGRST202", message: "Missing domain" }); await expect(f.port.begin(challenge)).rejects.toThrow("identity_unavailable");
    for (const code of ["identity_expired", "profile_required"] as const) {
      f.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: code } }); await expect(f.port.consume(challenge)).rejects.toThrow(code);
    }
    f.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "profile_verified_identities_provider_external_id_key" } });
    await expect(f.port.complete(challenge, identity)).rejects.toThrow("identity_conflict"); expect(f.rpc).toHaveBeenCalledTimes(4); expect(f.from).not.toHaveBeenCalled();
  });
  it("provider mismatch refuses before RPC and enrolled core exposes no domain before any I/O", async () => {
    const f = fixture(null); await expect(f.port.complete(challenge, { provider: "orcid", externalId: "0000-0002-1825-0097", label: "Alice" })).rejects.toThrow("identity_expired");
    const deployment = { format: "keryx-storage-deployment-v1", identity: syntheticStorageIdentity("testnet-offline"), backend: { kind: "supabase", url: "https://synthetic-db.example", projectRef: "synthetic-db", credentialEnv: "SUPABASE_SERVICE_ROLE_KEY" } } as unknown as StorageDeploymentManifest;
    const read = vi.fn(() => deployment), core = assembleAuthorityBoundSupabaseCore(f.client, deployment, read); read.mockClear();
    expect(Object.hasOwn(core.adapter, "profileIdentities")).toBe(false); expect(() => requireProfileIdentities(core.adapter)).toThrow("identity_unavailable");
    expect(read).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
  });
});
