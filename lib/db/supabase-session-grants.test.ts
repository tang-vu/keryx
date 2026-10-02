import { afterEach, expect, it, vi } from "vitest";
import { SupabaseAdapter } from "./supabase-adapter";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("passes captured grant identity through both atomic spend RPCs", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(true))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", http);
  const db = new SupabaseAdapter();

  expect(await db.addSessionGrantSpend("owner", "epoch-old", "0xSigner", 0.006)).toBe(true);
  await db.releaseSessionGrantSpend("owner", "epoch-old", "0xSigner", 0.006);

  expect(String(http.mock.calls[0][0])).toContain("/rpc/reserve_session_grant_spend");
  expect(String(http.mock.calls[1][0])).toContain("/rpc/release_session_grant_spend");
  for (const [, init] of http.mock.calls) {
    expect(JSON.parse(String(init?.body))).toMatchObject({
      p_session_id: "owner",
      p_grant_epoch: "epoch-old",
      p_sess_addr: "0xSigner",
      p_amount: 0.006,
    });
  }
});

it.each([{}, { active: "false" }, null])("fails closed on malformed successful activation reads", async row => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json(row));
  vi.stubGlobal("fetch", http);
  const db = new SupabaseAdapter();
  await expect(db.browserJournalActive()).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(1);
});
