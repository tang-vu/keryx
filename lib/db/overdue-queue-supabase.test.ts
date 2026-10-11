import { afterEach, expect, it, vi } from "vitest";
import { SupabaseAdapter } from "./supabase-adapter";
import { monthlyOrderToRow } from "./research-monthly";
import { syntheticA2aOriginal } from "./a2a-original-fixture";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function fixture() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-overdue.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-authority");
  const http = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", http);
  return { http, db: new SupabaseAdapter() };
}
function response(rows: unknown[], count: number) {
  return Response.json(rows, { headers: { "content-range": `${rows.length ? `0-${rows.length - 1}` : "*"}/${count}` } });
}

it("reads both unfinished states in stable bounded order and uses exact count to expose server row caps", async () => {
  const { db, http } = fixture();
  const order = syntheticA2aOriginal().order;
  http.mockResolvedValueOnce(response([monthlyOrderToRow(order)], 10));
  expect(await db.listUnfinishedA2aOrders(5)).toEqual({ orders: [order], unreadable: 0, truncated: true });
  const [url, options] = http.mock.calls[0];
  const query = new URL(String(url));
  expect(query.pathname).toBe("/rest/v1/a2a_orders");
  expect(query.searchParams.get("status")).toBe("in.(running,failed)");
  expect(query.searchParams.get("order")).toBe("created_at.asc,id.asc");
  expect(query.searchParams.get("limit")).toBe("6");
  expect(new Headers(options?.headers).get("prefer")).toContain("count=exact");
  expect(options?.method).toBe("GET");
  http.mockResolvedValueOnce(response([], 0));
  expect(await db.listUnfinishedA2aOrders(1)).toEqual({ orders: [], unreadable: 0, truncated: false });
});

it("refuses absent/inconsistent counts, failed reads and invalid limits without claiming an empty queue", async () => {
  const { db, http } = fixture();
  const row = monthlyOrderToRow(syntheticA2aOriginal().order);
  http.mockResolvedValueOnce(Response.json([]));
  await expect(db.listUnfinishedA2aOrders(5)).rejects.toThrow("unavailable");
  http.mockResolvedValueOnce(response([row], 0));
  await expect(db.listUnfinishedA2aOrders(5)).rejects.toThrow("unavailable");
  http.mockResolvedValueOnce(new Response("{}", { status: 503 }));
  await expect(db.listUnfinishedA2aOrders(5)).rejects.toThrow();
  http.mockClear();
  await expect(db.listUnfinishedA2aOrders(0)).rejects.toThrow("invalid");
  expect(http).not.toHaveBeenCalled();
});
