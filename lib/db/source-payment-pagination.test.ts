import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseAdapter } from "./supabase-adapter";

vi.mock("@supabase/supabase-js", async original => ({ ...await original<typeof import("@supabase/supabase-js")>(), createClient: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function reader(pages: Array<{ data: Record<string, unknown>[] | null; error: Error | null }>) {
  const query = { select: vi.fn(), or: vi.fn(), eq: vi.fn(), neq: vi.fn(), order: vi.fn(), range: vi.fn() };
  for (const method of [query.select, query.or, query.eq, query.neq, query.order]) method.mockReturnValue(query);
  for (const page of pages) query.range.mockResolvedValueOnce(page);
  const from = vi.fn(() => query);
  vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
  return { db: new SupabaseAdapter(), query, from };
}
const payment = (index: number) => ({ id: `p${index}`, query_id: `q${index}`, kind: "operating-fee",
  source_id: "keryx:operating-fee", source_name: "Keryx operating fee", payer: "payer", payee: "owner",
  amount_usdc: 0.000001, network: "eip155:5042", settled: true, settlement_status: "settled", tx_hash: "synthetic proof",
  created_at: "2026-10-14T00:00:00Z" });

it("reads beyond the PostgREST cap with a stable id tie-breaker", async () => {
  const { db, query } = reader([{ data: Array.from({ length: 1000 }, (_, i) => payment(i)), error: null },
    { data: [payment(1000)], error: null }]);
  const result = await db.listPaymentsBySource("keryx:operating-fee");
  expect(result.length).toBe(1001);
  expect(result.at(-1)?.id).toBe("p1000");
  expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  expect(query.eq).toHaveBeenCalledWith("source_id", "keryx:operating-fee");
  expect(query.order).toHaveBeenCalledWith("id", { ascending: false });
});

it("does not return a partial all-time history when a later page fails", async () => {
  const failure = new Error("second page refused");
  const { db } = reader([{ data: Array.from({ length: 1000 }, (_, i) => payment(i)), error: null },
    { data: null, error: failure }]);
  await expect(db.listPaymentsBySource("keryx:operating-fee")).rejects.toBe(failure);
});

it("requires actual rows rather than treating an absent page as empty", async () => {
  const { db } = reader([{ data: null, error: null }]);
  await expect(db.listPaymentsBySource("keryx:operating-fee")).rejects.toThrow("Source payment history unavailable");
});
