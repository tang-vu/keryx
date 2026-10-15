/** Transport/validation controls only; real PostgreSQL acceptance is separate. */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryRun } from "../types";
import { createSupabaseResearchPublication } from "../db/research-publication-supabase";
import { createSupabaseRunPrivacy } from "../db/run-privacy-supabase";
import type { PrivacyActor, RunVisibility } from "./contracts";

const wallet = `0x${"a".repeat(40)}`;
const actor: PrivacyActor = { wallet, binding: { network: "eip155:5042", origin: "https://synthetic-publication.example" } };
const original = (): QueryRun => ({ id: "synthetic-ordinary", createdAt: "2026-10-15T00:00:00.000Z",
  question: "Synthetic public research", answer: "Synthetic answer", budget: 0.03, engine: "heuristic",
  totalSpent: 0.012345, totalToCreators: 0.000001, subClaims: [], decisions: [], citations: [], trace: [], asker: wallet });
function fixture() {
  let reply: unknown = { data: null, error: null };
  const abortSignal = vi.fn(async (_signal: AbortSignal) => reply);
  const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => ({ abortSignal }));
  const from = vi.fn(() => { throw Error("REST must not be used"); });
  const client = { rpc, from } as unknown as SupabaseClient;
  return { rpc, from, abortSignal, client, store: createSupabaseResearchPublication(client),
    packet(action: string, id: string | null, result: unknown) { reply = { data: { version: 1, action, id, result }, error: null }; },
    reply(value: unknown) { reply = value; } };
}

describe("fixed ordinary publication boundary", () => {
  it("composes genuine readiness through the privacy port without a legacy RPC or REST call", async () => {
    const f = fixture(); f.packet("ready", null, { ready: true });
    await createSupabaseRunPrivacy(f.client).creationReady();
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("research_publication_v1", { p_action: "ready", p_input: {} });
    expect(f.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal); expect(f.from).not.toHaveBeenCalled();
  });
  it.each(["private", "unlisted", "public"] as const)("preserves the source RPC's %s preference", async visibility => {
    const f = fixture(); f.packet("defaults", null, visibility);
    expect(await createSupabaseRunPrivacy(f.client).defaults({ ...actor, wallet: wallet.toUpperCase().replace("0X", "0x") })).toBe(visibility);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("research_publication_v1", { p_action: "defaults", p_input: { wallet, binding: actor.binding } });
  });
  it("sends original and sidecar intent together with the existing fixed original mapping", async () => {
    const f = fixture(), run = original(); f.packet("save", run.id, { saved: true });
    await f.store.saveQueryRun(run, { visibility: "private" });
    const [name, args] = f.rpc.mock.calls[0], input = args.p_input as { row: Record<string, unknown>; publication: unknown };
    expect(name).toBe("research_publication_v1"); expect(args.p_action).toBe("save");
    expect(input.publication).toEqual({ visibility: "private" }); expect(input.row.data).toEqual(run);
    expect(Object.keys(input.row).sort()).toEqual(["id", "created_at", "question", "budget", "engine", "total_spent", "total_to_creators", "answer", "data",
      "parent_id", "asker", "origin", "mcp_client", "duration_ms", "payment_mode", "payment_attempts", "settled_payments", "confidence_level",
      "evidence_claim_count", "grounded_claim_count", "rewarded_citation_count", "economics_data"].sort());
    expect(input.row).toMatchObject({ total_spent: 0.012345, total_to_creators: 0.000001, asker: wallet, parent_id: null });
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(f.from).not.toHaveBeenCalled();
  });
  it("leaves an omitted choice absent for the database's presence-aware decision", async () => {
    const f = fixture(); f.packet("save", original().id, { saved: true }); await f.store.saveQueryRun(original());
    expect(f.rpc.mock.calls[0][1].p_input).not.toHaveProperty("publication");
  });
  it("snapshots caller data and intent before the request is pending", async () => {
    const f = fixture(), run = original(), selected = { visibility: "unlisted" as RunVisibility };
    f.packet("save", run.id, { saved: true }); const pending = f.store.saveQueryRun(run, selected);
    run.answer = "Later mutation"; selected.visibility = "public"; await pending;
    const input = f.rpc.mock.calls[0][1].p_input as { row: { data: QueryRun }; publication: unknown };
    expect(input.row.data.answer).toBe("Synthetic answer"); expect(input.publication).toEqual({ visibility: "unlisted" });
  });
  it("does not categorically reject historically public A2A fulfillment metadata", async () => {
    const f = fixture(), run = { ...original(), originalFulfillment: { synthetic: true } } as unknown as QueryRun;
    f.packet("save", run.id, { saved: true }); await f.store.saveQueryRun(run);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects private job routing, invalid choices and malformed originals before dispatch", async () => {
    for (const [run, choice] of [
      [{ ...original(), id: `prv_${"a".repeat(64)}` }, undefined],
      [{ ...original(), parentId: `prv_${"a".repeat(64)}` }, undefined],
      [original(), { visibility: "private", extra: true }], [original(), { visibility: "invalid" }],
      [{ ...original(), budget: Number.NaN }, undefined], [{ ...original(), trace: null }, undefined],
      [{ ...original(), asker: "invalid" }, undefined],
    ] as Array<[QueryRun, unknown]>) {
      const f = fixture(); await expect(f.store.saveQueryRun(run, choice as { visibility: RunVisibility })).rejects.toMatchObject({ code: "privacy_unavailable" });
      expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
    }
  });
  it("never interprets null/malformed defaults as the absence fallback", async () => {
    for (const result of [null, undefined, {}, { present: false }, "invalid"]) {
      const f = fixture(); f.packet("defaults", null, result);
      await expect(f.store.defaults(actor)).rejects.toMatchObject({ code: "privacy_unavailable" }); expect(f.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("normalizes failed or mismatched envelopes without another attempt", async () => {
    for (const reply of [
      { data: null, error: { message: "SECRET backend failure" } },
      { data: { version: 2, action: "ready", id: null, result: { ready: true } }, error: null },
      { data: { version: 1, action: "ready", id: "wrong", result: { ready: true } }, error: null },
      { data: { version: 1, action: "ready", id: null, result: { ready: false } }, error: null },
    ]) {
      const f = fixture(); f.reply(reply);
      await expect(f.store.creationReady()).rejects.toMatchObject({ code: "privacy_unavailable", message: "privacy_unavailable" });
      expect(f.rpc).toHaveBeenCalledTimes(1); expect(f.from).not.toHaveBeenCalled();
    }
  });
});
