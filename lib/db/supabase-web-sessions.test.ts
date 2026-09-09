import { afterEach, expect, it, vi } from "vitest";
import { SupabaseAdapter } from "./supabase-adapter";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const wallet = `0x${"a".repeat(40)}`, hash = "b".repeat(64);
function adapter() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  return new SupabaseAdapter();
}
it("creates privately, reads by exact hash and revokes only the matching wallet", async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json([{ hash, wallet, issued_at: 1000, expires_at: 2000 }]))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", http); const db = adapter();
  await db.createWebSession({ hash, wallet, issuedAt: 1000, expiresAt: 2000 });
  expect(await db.getWebSession(hash)).toEqual({ hash, wallet, issuedAt: 1000, expiresAt: 2000 });
  await db.revokeWebSession(hash, wallet.toUpperCase());
  expect(String(http.mock.calls[0][0])).toContain("/rpc/create_web_session");
  const url = new URL(String(http.mock.calls[2][0]));
  expect(http.mock.calls[2][1]?.method).toBe("DELETE");
  expect(url.searchParams.get("hash")).toBe(`eq.${hash}`);
  expect(url.searchParams.get("wallet")).toBe(`eq.${wallet}`);
});
it("propagates storage failures without reporting revocation", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 503 })));
  const db = adapter();
  await expect(db.createWebSession({ hash, wallet, issuedAt: 1000, expiresAt: 2000 })).rejects.toThrow();
  await expect(db.revokeWebSession(hash, wallet)).rejects.toThrow();
});
