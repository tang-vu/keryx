import { afterEach, expect, it, vi } from "vitest";
import { SupabaseAdapter } from "./supabase-adapter";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("uses the private owner RPC with a bound cursor and propagates failures", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-history.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(new Response("{}", { status: 503 }));
  vi.stubGlobal("fetch", http);
  const db = new SupabaseAdapter(), wallet = `0x${"a".repeat(40)}`;
  const before = { createdAt: "2026-09-09T00:00:00.000Z", id: `a2a_${"b".repeat(64)}` };
  expect(await db.listA2aOrdersByPayer(wallet.toUpperCase(), before)).toEqual([]);
  expect(String(http.mock.calls[0][0])).toContain("/rpc/list_a2a_orders_for_payer");
  expect(JSON.parse(String(http.mock.calls[0][1]?.body))).toEqual({ p_wallet: wallet, p_before_created_at: before.createdAt, p_before_id: before.id });
  await expect(db.listA2aOrdersByPayer(wallet)).rejects.toThrow();
});
