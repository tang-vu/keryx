import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter } from "./supabase-adapter";
import { parseDecisionBasis, withDecisionBasis } from "../research/decision-basis";
import type { Decision, QueryRun } from "../types";

const owner = `0x${"a".repeat(40)}`;
function decision(id: string, action: Decision["action"], expectedValue: number, price: number): Decision {
  return { sourceId: id, assetId: `item:${id}`, itemId: id, contentVersion: "v1", sourceName: id, action, expectedValue,
    price, confidence: 0.6, rationale: "Synthetic offline decision.", targets: [0] };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("stores the structured decision basis unchanged through both actual adapters", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-decision-basis-parity-"));
  const sqlite = new SqliteAdapter(path.join(folder, "test.sqlite")); await sqlite.init();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-decision-basis.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  const stored = new Map<string, { id: string; asker: string | null; data: QueryRun }>();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== "synthetic-decision-basis.example") throw Error("Unexpected outbound request in isolated adapter fixture");
    // Metadata-only provenance lookup for the recorded identities: no synthetic-demo flags here.
    if (["/rest/v1/sources", "/rest/v1/source_items"].includes(url.pathname) && !options?.method?.match(/POST|PATCH|DELETE/))
      return Response.json([]);
    if (url.pathname !== "/rest/v1/query_runs") throw Error("Unexpected outbound request in isolated adapter fixture");
    if (options?.method === "POST") {
      const row = JSON.parse(String(options.body)); stored.set(row.id, row);
      return new Response(null, { status: 201 });
    }
    const asked = url.searchParams.get("asker");
    return Response.json([...stored.values()].filter(row => `eq.${row.asker}` === asked).map(row => ({ data: row.data })));
  }));
  const supabase = new SupabaseAdapter();
  const decisions = withDecisionBasis([decision("bought", "BUY", 0.8, 0.002), decision("passed", "SKIP", 0.4, 0.003)],
    { fetchBudgetUsdc: 0.035, ruleFor: row => row.action === "BUY" ? "selected" : "portfolio" });
  const legacy = [decision("legacy", "BUY", 0.5, 0.001)];
  const runs: QueryRun[] = [{ id: "with-basis", decisions }, { id: "legacy", decisions: legacy }].map(row => ({
    question: "Synthetic decision-basis fixture", budget: 0.05, engine: "heuristic", subClaims: ["claim"], citations: [],
    answer: "Offline fixture", totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-11T00:00:00.000Z",
    paymentMode: "offline", asker: owner, ...row }));
  try {
    for (const db of [sqlite, supabase]) {
      for (const run of runs) await db.saveQueryRun(run);
      const history = await db.listQueryRunsByAsker(owner, 10);
      const read = history.find(run => run.id === "with-basis")!;
      expect(read.decisions.map(row => parseDecisionBasis(row.basis))).toEqual(decisions.map(row => row.basis));
      expect(read.decisions[0].basis).toEqual({ version: 1, plannedAction: "BUY", rule: "selected", quotedPriceMicroUsdc: "2000",
        fetchBudgetMicroUsdc: "35000", budgetLeftMicroUsdc: "35000",
        alternative: { assetId: "item:passed", sourceId: "passed", action: "SKIP", expectedValue: 0.4, quotedPriceMicroUsdc: "3000" } });
      // History written before this field existed is neither rewritten nor given an invented basis.
      expect(history.find(run => run.id === "legacy")!.decisions[0]).not.toHaveProperty("basis");
    }
    expect(stored.get("with-basis")?.data.decisions[1].basis?.budgetLeftMicroUsdc).toBe("33000");
  } finally {
    sqlite.close(); fs.rmSync(folder, { recursive: true, force: true });
  }
});
