import { afterEach, expect, it, vi } from "vitest";
import { SupabaseAdapter } from "./supabase-adapter";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function adapter() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-database.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  return new SupabaseAdapter();
}

it("uses server-only RPCs and distinguishes consumed from missing without truthy coercion", async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json(true))
    .mockResolvedValueOnce(Response.json(false))
    .mockResolvedValueOnce(Response.json("true"));
  vi.stubGlobal("fetch", http);
  const database = adapter(); const hash = "a".repeat(64);
  await database.createAuthChallenge(hash, 1000, 2000);
  expect(await database.consumeAuthChallenge(hash, 1500)).toBe(true);
  expect(await database.consumeAuthChallenge(hash, 1500)).toBe(false);
  await expect(database.consumeAuthChallenge(hash, 1500)).rejects.toThrow();
  expect(String(http.mock.calls[0][0])).toContain("/rpc/create_auth_challenge");
  expect(JSON.parse(http.mock.calls[0][1]?.body as string)).toEqual({ p_hash: hash, p_issued_at: 1000, p_expires_at: 2000 });
  expect(String(http.mock.calls[1][0])).toContain("/rpc/consume_auth_challenge");
});

it("rejects unavailable challenge storage rather than reporting consumption", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 })));
  const database = adapter();
  await expect(database.consumeAuthChallenge("b".repeat(64), 1500)).rejects.toThrow();
  await expect(database.createAuthChallenge("b".repeat(64), 1000, 2000)).rejects.toThrow();
});
