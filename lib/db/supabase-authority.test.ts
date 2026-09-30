import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseAuthority } from "./supabase-authority";
import { STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";

const identity: StorageIdentity = { format: "keryx-storage-identity-v1", deploymentId: "11111111-1111-4111-8111-111111111111",
  storageId: "22222222-2222-4222-8222-222222222222", network: "eip155:5042002", authorityMode: "testnet-real",
  profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, enrollmentId: "33333333-3333-4333-8333-333333333333",
  enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "a".repeat(64) };

function fixture(marker: unknown = identity, refusal = false) {
  const requests: { path: string; body: unknown }[] = [];
  const client = createClient("https://synthetic.invalid", "synthetic-test-role", { auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
      if (path.endsWith("read_storage_identity")) return new Response(JSON.stringify(marker), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify(refusal ? { code: "P0001", message: "storage identity refused: identity_mismatch" } : null),
        { status: refusal ? 400 : 200, headers: { "Content-Type": "application/json" } });
    } } });
  return { authority: new SupabaseAuthority(client, identity), requests };
}

describe("Supabase authority HTTP boundary", () => {
  it("refuses metadata and authority access before marker admission", () => {
    const { authority, requests } = fixture();
    expect(() => authority.getStorageIdentity()).toThrow();
    expect(() => authority.rpc("get_source", { p_id: "source" })).toThrow();
    expect(requests).toHaveLength(0);
  });
  it("never adopts a different complete identity from the target", async () => {
    const { authority } = fixture({ ...identity, storageId: "44444444-4444-4444-8444-444444444444" });
    await expect(authority.init()).rejects.toThrow();
    expect(() => authority.getStorageIdentity()).toThrow();
  });
  it("sends canonical full identity with typed named RPC arguments", async () => {
    const { authority, requests } = fixture();
    await authority.init();
    expect(Object.isFrozen(authority.getStorageIdentity())).toBe(true);
    const result = await authority.rpc("get_source", { p_id: "source" });
    expect(result.data).toBeNull();
    expect(requests[1]).toEqual({ path: "/rest/v1/rpc/storage_get_source", body: { p_id: "source", p_expected_identity: identity } });
    expect(() => authority.rpc("get_source", { p_expected_identity: identity })).toThrow();
  });
  it("propagates SQL admission refusal instead of silently returning empty data", async () => {
    const { authority } = fixture(identity, true);
    await authority.init();
    await expect(authority.rpc("get_source", { p_id: "source" })).rejects.toMatchObject({ code: "P0001" });
  });
});
