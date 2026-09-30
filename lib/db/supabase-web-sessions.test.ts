import { afterEach, expect, it, vi } from "vitest";
import { testSupabaseAdapter, supabaseTestIdentity } from "./supabase-authority-test-fixture";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const wallet = `0x${"a".repeat(40)}`, hash = "b".repeat(64);
async function adapter() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  return testSupabaseAdapter();
}
const body = (call: [unknown, RequestInit?]) => JSON.parse(String(call[1]?.body));
it("creates privately, reads by exact hash and revokes only the matching wallet", async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ hash, wallet, issued_at: 1000, expires_at: 2000 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", http); const db = await adapter();
  await db.createWebSession({ hash, wallet, issuedAt: 1000, expiresAt: 2000 });
  expect(await db.getWebSession(hash)).toEqual({ hash, wallet, issuedAt: 1000, expiresAt: 2000 });
  await db.revokeWebSession(hash, wallet.toUpperCase());
  expect(String(http.mock.calls[0][0])).toContain("/rpc/storage_create_web_session");
  expect(String(http.mock.calls[2][0])).toContain("/rpc/storage_revoke_web_session");
  expect(http.mock.calls[2][1]?.method).toBe("POST");
  expect(body(http.mock.calls[2])).toEqual({ p_hash: hash, p_wallet: wallet, p_expected_identity: supabaseTestIdentity });
});
it("propagates storage failures without reporting revocation", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 503 })));
  const db = await adapter();
  await expect(db.createWebSession({ hash, wallet, issuedAt: 1000, expiresAt: 2000 })).rejects.toThrow();
  await expect(db.revokeWebSession(hash, wallet)).rejects.toThrow();
  await expect(db.listWebSessions(wallet, 1000)).rejects.toThrow();
  await expect(db.revokeOtherWebSessions(wallet, hash)).rejects.toThrow();
});
it("bounds active-session listing and scopes bulk deletion to the wallet excluding this session", async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ hash, wallet, issued_at: 1000, expires_at: 3000 }]))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", http); const db = await adapter();
  expect(await db.listWebSessions(wallet.toUpperCase(), 2000)).toEqual([{ hash, wallet, issuedAt: 1000, expiresAt: 3000 }]);
  await db.revokeOtherWebSessions(wallet.toUpperCase(), hash);
  expect(body(http.mock.calls[0])).toEqual({ p_wallet: wallet, p_issued_at: 2000, p_expires_at: 2000, p_limit: 101, p_expected_identity: supabaseTestIdentity });
  expect(body(http.mock.calls[1])).toEqual({ p_wallet: wallet, p_hash: hash, p_expected_identity: supabaseTestIdentity });
  expect(String(http.mock.calls[1][0])).toContain("/rpc/storage_revoke_other_web_sessions");
});
