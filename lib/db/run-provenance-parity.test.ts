import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter } from "./supabase-adapter";
import type { QueryRun } from "../types";

const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`;
function run(id: string, extra: Partial<QueryRun> = {}): QueryRun {
  return { id, question: "Synthetic ownership fixture", budget: 0, engine: "heuristic", subClaims: [],
    decisions: [], citations: [], answer: "Offline fixture", totalSpent: 0, totalToCreators: 0, trace: [],
    createdAt: "2026-10-09T00:00:00.000Z", paymentMode: "offline", ...extra };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("round trips new provenance and preserves legacy/ownerless history through both actual adapters", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-provenance-parity-"));
  const sqlite = new SqliteAdapter(path.join(folder, "test.sqlite")); await sqlite.init();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-provenance.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  const stored = new Map<string, { id: string; asker: string | null; data: QueryRun }>();
  const http = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== "synthetic-provenance.example" || url.pathname !== "/rest/v1/query_runs")
      throw Error("Unexpected outbound request in isolated adapter fixture");
    if (options?.method === "POST") {
      const row = JSON.parse(String(options.body)); stored.set(row.id, row);
      return new Response(null, { status: 201 });
    }
    const asked = url.searchParams.get("asker");
    expect(asked).toMatch(/^eq\.0x[a-f0-9]{40}$/);
    const limit = Number(url.searchParams.get("limit")); expect(limit).toBeGreaterThan(0);
    return Response.json([...stored.values()].filter(row => `eq.${row.asker}` === asked).slice(0, limit).map(row => ({ data: row.data })));
  });
  vi.stubGlobal("fetch", http);
  const supabase = new SupabaseAdapter();
  const owned = [run("key", { asker: owner.toUpperCase(),
    provenance: { version: 1, surface: "api", ownershipMethod: "api-key" } }),
  run("payer", { asker: owner, provenance: { version: 1, surface: "agent-to-agent", ownershipMethod: "verified-payer" } }),
  run("legacy", { asker: owner, origin: "web" })];
  const anonymous = run("anonymous", { origin: "mcp", mcpClient: "codex",
    provenance: { version: 1, surface: "remote-mcp", ownershipMethod: "api-key" } });
  try {
    for (const db of [sqlite, supabase]) {
      for (const value of [...owned, anonymous]) await db.saveQueryRun(value);
      const history = await db.listQueryRunsByAsker(owner, 200);
      expect(history.map(value => value.id).sort()).toEqual(["key", "legacy", "payer"]);
      expect(history.find(value => value.id === "key")?.provenance).toEqual(owned[0].provenance);
      expect(history.find(value => value.id === "payer")?.provenance).toEqual(owned[1].provenance);
      expect(history.find(value => value.id === "legacy")).not.toHaveProperty("provenance");
      expect(await db.listQueryRunsByAsker(other, 200)).toEqual([]);
      expect((await db.listQueryRunsByAsker(owner, 1))).toHaveLength(1);
    }
    expect(stored.get("anonymous")?.asker).toBeNull();
    expect(stored.get("anonymous")?.data.provenance).toEqual({ version: 1, surface: "remote-mcp", ownershipMethod: "unknown" });
    expect(await sqlite.getQueryRun("anonymous")).toMatchObject({ provenance: { ownershipMethod: "unknown" } });
    expect(anonymous.provenance?.ownershipMethod).toBe("api-key"); // Writer snapshot never mutates the input.
    expect(http).toHaveBeenCalled();
  } finally {
    sqlite.close(); fs.rmSync(folder, { recursive: true, force: true });
  }
});
