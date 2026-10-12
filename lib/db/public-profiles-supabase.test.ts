import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createSupabasePublicProfiles } from "./public-profiles-supabase";

const wallet = `0x${"a".repeat(40)}`, actor = { wallet, sessionHash: "a".repeat(64), binding: { network: "eip155:5042002" as const, origin: "https://profile-fixture.example" } };
const date = "2026-10-12T00:00:00.000Z";
const profile = { version: 1, handle: "alice", publishedAt: date, ownershipBasis: "signed-wallet-publication-existing-run-proof" };
const source = { id: "public", question: "Question", createdAt: date, citations: [], provenance: { version: 1, surface: "desktop", ownershipMethod: "session" } };
function fixture(result: unknown, action = "read", handle: string | null = "alice", error: unknown = null) {
  const abortSignal = vi.fn(async (_signal: AbortSignal) => ({ data: { version: 1, action, handle, result }, error })), rpc = vi.fn(() => ({ abortSignal }));
  const from = vi.fn(() => { throw new Error("No REST fallback"); });
  return { rpc, from, abortSignal, store: createSupabasePublicProfiles({ rpc, from } as unknown as SupabaseClient, true) };
}
describe("#264 fixed Supabase publication contract", () => {
  it("projects the typed original source packet and uses one exact RPC with a bounded deadline", async () => {
    const f = fixture({ profile, runs: [{ source, claimed: false, networks: [actor.binding.network] }] });
    expect((await f.store.read("alice"))?.runs[0]).toMatchObject({ surface: "desktop", ownership: "session", network: actor.binding.network });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("public_researcher_profile_v1", { p_action: "read", p_handle: "alice", p_actor: null, p_input: {}, p_claims: true });
    expect(f.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal); expect(f.from).not.toHaveBeenCalled();
  });
  it("rejects mismatched handles, private body extras, unsafe original IDs, malformed networks and incorrect verified identities", async () => {
    for (const result of [
      { profile: { ...profile, handle: "bobby" }, runs: [] }, { profile: { ...profile, wallet }, runs: [] },
      { profile, runs: [{ source: { ...source, answer: "PRIVATE" }, claimed: false, networks: [] }] },
      { profile, runs: [{ source: { ...source, id: "../private" }, claimed: false, networks: [] }] },
      { profile, runs: [{ source, claimed: false, networks: [null] }] },
      { profile: { ...profile, verifiedLinks: [{ provider: "orcid", label: "Alice", url: "https://secret@orcid.org/0000-0002-1825-0097", verifiedAt: date }] }, runs: [] },
    ]) { const f = fixture(result); await expect(f.store.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" }); expect(f.from).not.toHaveBeenCalled(); }
  });
  it("preserves unavailable/unknown outcomes without retry and requires exact mutation acknowledgment", async () => {
    const absent = fixture(null); expect(await absent.store.read("alice")).toBeNull();
    const failed = fixture(null, "read", "alice", { message: "PRIVATE unavailable schema" });
    await expect(failed.store.read("alice")).rejects.toThrow("public_profile_unavailable"); expect(failed.rpc).toHaveBeenCalledTimes(1);
    const settings = { handle: "alice", published: true, fields: [], runIds: [], revision: 1, updatedAt: date };
    const wrong = fixture(settings, "update", null); await expect(wrong.store.update(actor, { published: true, fields: [], runIds: [], revision: 1 })).rejects.toMatchObject({ code: "public_profile_unavailable" });
    const revoked = fixture({ unpublished: true }, "unpublish", null); await revoked.store.unpublish(actor); expect(revoked.from).not.toHaveBeenCalled();
    const unknown = fixture({ unpublished: false }, "unpublish", null); await expect(unknown.store.unpublish(actor)).rejects.toThrow("public_profile_unavailable");
  });
  it("surfaces durable tombstone revision and stale/expired publication refusal without REST fallback",async()=>{
    const settings={handle:"alice",published:false,fields:[],runIds:[],revision:1,updatedAt:date};
    const tombstone=fixture(settings,"settings",null);expect(await tombstone.store.settings(actor)).toEqual(settings);
    for(const message of ["conflict","unauthenticated"]){
      const rejected=fixture(null,"update",null,{message});
      await expect(rejected.store.update(actor,{published:true,fields:["about","purpose"],runIds:["private-selected"],revision:0})).rejects.toMatchObject({code:message});
      expect(rejected.rpc).toHaveBeenCalledTimes(1);expect(rejected.from).not.toHaveBeenCalled();
    }
    const missing=fixture(null,"unpublish",null,{message:"profile_required"});
    await expect(missing.store.unpublish(actor)).rejects.toMatchObject({code:"profile_required"});expect(missing.from).not.toHaveBeenCalled();
  });
  it("keeps the SOURCE-only installer on existing proof contracts and closes table/function grants", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/0091_public_researcher_profiles.sql", import.meta.url), "utf8");
    expect(sql).toContain("public.run_privacy_guard_v1()"); expect(sql).toContain("public.anonymous_run_claim_history_read_v1(who,selection.binding->>'network',selection.binding->>'origin',row.id)");
    expect(sql).toContain("proof->'item'->'ownership'->>'method'='claimed'"); expect(sql).toContain("p.visibility='public' and not p.erased and selection.run_ids ? q.id");
    expect(sql).toContain("enable row level security"); expect(sql).toContain("from public,anon,authenticated"); expect(sql).toContain("to service_role");
    expect(sql).toContain("issued_at<=stamp and expires_at>stamp"); expect(sql).toContain("e.settlement_status='settled'"); expect(sql).toContain("e.network=target_network");
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(?:query_runs|payment_events|run_privacy|anonymous_run_claims)\b/i);
  });
});
