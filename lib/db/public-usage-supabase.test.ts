import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabasePublicUsage } from "./public-usage-supabase";
import { newRunUsage, createTrustedUsageContext } from "../research/usage-provenance";
import { UsageUnavailable, usageWindow } from "../usage/contracts";
import type { RunPrivacyStore } from "../run-privacy/contracts";
const window = usageWindow(new URLSearchParams(), "eip155:5042", new Date("2026-10-11T00:00:00.000Z"));
const wallet = `0x${"a".repeat(40)}`;
describe("ordinary Supabase public usage RPC", () => {
  it("refuses missing/partial/misbound RPC with no native or paginated REST summary fallback", async () => {
    for (const result of [{ data: null, error: { code: "PGRST202" } }, { data: { complete: false }, error: null },
      { data: { complete: true, window: { ...window, network: "eip155:5042002" }, runs: [], payments: [] }, error: null }]) {
      const from = vi.fn(), abortSignal = vi.fn().mockResolvedValue(result), rpc = vi.fn(() => ({ abortSignal }));
      await expect(createSupabasePublicUsage({ rpc, from } as unknown as SupabaseClient).summary(window)).rejects.toThrow(UsageUnavailable);
      expect(rpc).toHaveBeenCalledWith("public_usage_window_v1", { p_window: window }); expect(from).not.toHaveBeenCalled();
    }
  });
  it("selects a classified complete-window page first, then refuses changed body cohort", async () => {
    const usage = newRunUsage({ usageContext: createTrustedUsageContext(window.network,
      { actor: "outside", funding: "unknown", scripted: false, actorEvidenceSha256: "a".repeat(64) }) }, window.network, []);
    const row = { id: "outside", createdAt: "2026-10-01T00:00:00.000Z", actorId: wallet, provenance: null, usage };
    const rpc = vi.fn(() => ({ abortSignal: vi.fn().mockResolvedValue({ data: { complete: true, window, runs: [row], payments: [] }, error: null }) }));
    const body = { id: row.id, created_at: row.createdAt, data: { id: row.id, createdAt: row.createdAt, usage } };
    const chain = { select: vi.fn(), in: vi.fn(), limit: vi.fn(), abortSignal: vi.fn() }; chain.select.mockReturnValue(chain); chain.in.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
    chain.abortSignal.mockResolvedValue({ data: [body], error: null }); const from = vi.fn(() => chain);
    const list=vi.fn(async()=>[body.data]);
    const store = createSupabasePublicUsage({ rpc, from } as unknown as SupabaseClient,()=>({list} as unknown as RunPrivacyStore));
    expect(await store.history(window, "outside", 1)).toHaveLength(1); expect(list).toHaveBeenCalledWith({take:1,ids:["outside"]});expect(from).not.toHaveBeenCalled();
    body.data.usage = { ...usage, cohort: "unknown", actorEvidenceSha256: null };
    await expect(store.history(window, "outside", 1)).rejects.toThrow(UsageUnavailable);
  });
});
