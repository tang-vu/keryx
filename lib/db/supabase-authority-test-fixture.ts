import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseAuthority } from "./supabase-authority";
import { SupabaseAdapter, throwingSupabaseFetch } from "./supabase-adapter";
import { STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";

/** Synthetic unit-test marker only; SQL enrollment is exercised by Docker CI. */
export const supabaseTestIdentity: StorageIdentity = {
  format: "keryx-storage-identity-v1", deploymentId: "11111111-1111-4111-8111-111111111111",
  storageId: "22222222-2222-4222-8222-222222222222", network: "eip155:5042002",
  authorityMode: "testnet-real", profileDigest: STORAGE_TESTNET_PROFILE_DIGEST,
  enrollmentId: "33333333-3333-4333-8333-333333333333", enrolledAt: "2026-10-01T00:00:00.000Z",
  provenanceDigest: "a".repeat(64),
};

export async function testSupabaseAuthority(client: SupabaseClient): Promise<SupabaseAuthority> {
  const markerClient = new Proxy(client, { get(target, property, receiver) {
    if (property !== "rpc") return Reflect.get(target, property, receiver);
    return (name: string, args?: Record<string, unknown>) => name === "read_storage_identity"
      ? Promise.resolve({ data: supabaseTestIdentity, error: null }) : target.rpc(name, args);
  } });
  const authority = new SupabaseAuthority(markerClient, supabaseTestIdentity);
  await authority.init();
  return authority;
}

export async function testSupabaseAdapter(): Promise<SupabaseAdapter> {
  const db = new SupabaseAdapter(supabaseTestIdentity);
  const client = createClient("https://synthetic-db.example", "synthetic-no-authority", {
    auth: { persistSession: false }, global: { fetch: throwingSupabaseFetch },
  });
  Object.assign(db, { sb: await testSupabaseAuthority(client) });
  return db;
}
