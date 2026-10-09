import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePrivateProfiles } from "./private-profiles-supabase";
import { assembleAuthorityBoundSupabaseCore } from "./supabase-adapter";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { requirePrivateProfiles } from "../profiles/private-profile";
import type { StorageDeploymentManifest } from "./runtime-storage-config";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const input = { displayName: "Alice", handle: "reader_01", bio: "Reader", purpose: "Papers", links: [] };
const record = { wallet: alice, ...input, createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
const snapshot = { profile: record, activity: { firstSeenAt: null, questions: 1201, surfacesUsed: ["web"], topics: ["biology"], creatorsPaid: 1, scope: "attributed-current-store", network: "eip155:5042" } };
afterEach(() => vi.restoreAllMocks());
function fixture(data: unknown, error: unknown = null) { const rpc = vi.fn().mockResolvedValue({ data, error }), from = vi.fn(() => { throw new Error("REST forbidden"); }); const client = { rpc, from } as unknown as SupabaseClient; return { client, rpc, from, port: createSupabasePrivateProfiles(client) }; }
describe("Supabase RPC-only private profiles", () => {
  it("uses bound owner on each RPC and retains complete activity beyond page limits", async () => { const f = fixture(snapshot); expect(await f.port.get(alice.toUpperCase().replace("0X", "0x"), "eip155:5042")).toEqual(snapshot); expect(f.rpc).toHaveBeenCalledWith("private_profile_get_v1", { p_wallet: alice, p_network: "eip155:5042" }); f.rpc.mockResolvedValue({ data: record, error: null }); expect(await f.port.update(alice, input)).toEqual(record); expect(f.rpc).toHaveBeenLastCalledWith("private_profile_update_v1", { p_wallet: alice, p_profile: input }); f.rpc.mockResolvedValue({ data: { deleted: true }, error: null }); await f.port.delete(alice); expect(f.rpc).toHaveBeenLastCalledWith("private_profile_delete_v1", { p_wallet: alice }); expect(f.from).not.toHaveBeenCalled(); });
  it.each([null, {}, { ...snapshot, profile: { ...record, wallet: bob } }, { ...snapshot, activity: { ...snapshot.activity, network: "eip155:5042002" } }, { ...snapshot, activity: { ...snapshot.activity, questions: -1 } }, { ...snapshot, publicProfile: record }])("refuses malformed/foreign responses instead of fabricating success", async body => { const f = fixture(body); await expect(f.port.get(alice, "eip155:5042")).rejects.toThrow("profile_unavailable"); expect(f.from).not.toHaveBeenCalled(); });
  it("missing/failed RPC capability never falls back, retries or claims a deletion", async () => { const f = fixture(null, { code: "PGRST202", message: "Missing profile domain" }); await expect(f.port.get(alice, "eip155:5042")).rejects.toThrow("profile_unavailable"); await expect(f.port.update(alice, input)).rejects.toThrow("profile_unavailable"); await expect(f.port.delete(alice)).rejects.toThrow("profile_unavailable"); expect(f.rpc).toHaveBeenCalledTimes(3); expect(f.from).not.toHaveBeenCalled(); });
  it("returns non-identifying collision and refuses foreign write acknowledgement", async () => { const f = fixture(null, { code: "23505", message: "private_profiles_handle_key" }); await expect(f.port.update(alice, input)).rejects.toThrow("handle_conflict"); f.rpc.mockResolvedValue({ data: { ...record, wallet: bob }, error: null }); await expect(f.port.update(alice, input)).rejects.toThrow("profile_unavailable"); f.rpc.mockResolvedValue({ data: { ...record, bio: "Different" }, error: null }); await expect(f.port.update(alice, input)).rejects.toThrow("profile_unavailable"); });
  it("actual enrolled core has no profile capability and refuses before any guard/RPC/REST I/O", () => {
    const f = fixture(snapshot); const deployment = { format: "keryx-storage-deployment-v1", identity: syntheticStorageIdentity("testnet-offline"), backend: { kind: "supabase", url: "https://synthetic-db.example", projectRef: "synthetic-db", credentialEnv: "SUPABASE_SERVICE_ROLE_KEY" } } as unknown as StorageDeploymentManifest;
    const read = vi.fn(() => deployment), core = assembleAuthorityBoundSupabaseCore(f.client, deployment, read);
    read.mockClear(); expect(Object.hasOwn(core.adapter, "privateProfiles")).toBe(false);
    expect(() => requirePrivateProfiles(core.adapter)).toThrow("profile_unavailable");
    expect(read).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
  });
});
