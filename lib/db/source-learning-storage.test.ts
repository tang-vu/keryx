import { afterEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter } from "./supabase-adapter";
import type { QueryRun } from "../types";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("retains the same additive source-learning JSON in actual SQLite and intercepted Supabase without new DDL", async () => {
  const sqlite = new SqliteAdapter(":memory:"); await sqlite.init();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-source-learning.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-authority");
  let stored: { data: QueryRun } | undefined;
  const http = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== "synthetic-source-learning.example" || url.pathname !== "/rest/v1/query_runs")
      throw new Error("Unexpected outbound request in isolated fixture");
    if (options?.method === "POST") { stored = JSON.parse(String(options.body)); return new Response(null, { status: 201 }); }
    return Response.json(stored);
  });
  vi.stubGlobal("fetch", http);
  const run: QueryRun = { id: "observational", question: "Synthetic source fixture", budget: 0, engine: "heuristic", subClaims: [],
    decisions: [], citations: [], answer: "Synthetic answer", totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-11T00:00:00.000Z",
    paymentMode: "offline", sourceLearning: { version: 1, network: "eip155:5042002", sources: [{ sourceId: "source-a", topics: ["x402"],
      eligibility: "offline", read: false, cached: false, bought: false, cited: false, accessMicros: "0", contribution: 0 }] } };
  try {
    for (const adapter of [sqlite, new SupabaseAdapter()]) {
      await adapter.saveQueryRun(run);
      expect((await adapter.getQueryRun(run.id))?.sourceLearning).toEqual(run.sourceLearning);
      await adapter.saveQueryRun({ ...run, sourceLearning: undefined });
      expect(await adapter.getQueryRun(run.id)).not.toHaveProperty("sourceLearning");
    }
  } finally { sqlite.close(); }
});
