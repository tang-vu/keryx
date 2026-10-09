import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSqliteDecisionReviews } from "./decision-reviews-sqlite";
import { createSupabaseDecisionReviews } from "./decision-reviews-supabase";
describe("ordinary review RPC boundary", () => {
  it("probes readiness without owner/private rows and refuses missing migration without any fallback", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "PRIVATE internal RPC diagnostic" } }));
    const store = createSupabaseDecisionReviews({ rpc } as unknown as SupabaseClient);
    await expect(store.ready()).rejects.toThrow("review_unavailable");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("decision_reviews_v1", { p_operation: "ready", p_wallet: null, p_input: {} });
  });
  it("accepts actual SQLite partial-rule/zero-vote aggregate parity and rejects wrong echo or invented rules", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const since = "2026-10-08T00:00:00.000Z", until = "2026-10-09T00:00:00.000Z";
      const summary = await createSqliteDecisionReviews(db).metrics("eip155:5042002", since, until);
      const rpc = vi.fn(async () => ({ data: summary, error: null })); const store = createSupabaseDecisionReviews({ rpc } as unknown as SupabaseClient);
      expect(await store.metrics(summary.network, since, until)).toEqual(summary);
      rpc.mockResolvedValueOnce({ data: { ...summary, network: "eip155:5042" } as typeof summary, error: null });
      await expect(store.metrics(summary.network, since, until)).rejects.toThrow("review_unavailable");
      rpc.mockResolvedValueOnce({ data: { ...summary, cohorts: [{ ...summary.cohorts[0], refusalReasons: { fabricated: 1 } }, ...summary.cohorts.slice(1)] } as typeof summary, error: null });
      await expect(store.metrics(summary.network, since, until)).rejects.toThrow();
      await expect(store.metrics(summary.network, undefined as unknown as string, until)).rejects.toThrow();
      expect(rpc).toHaveBeenCalledTimes(3);
    } finally { db.close(); }
  });
});
