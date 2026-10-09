import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../../app/mcp/route";
import * as apiKeys from "../api-keys";
import * as database from "../db";
const rawKey = `kx_live_${"1".repeat(96)}`, owner = `0x${"a".repeat(40)}`;
afterEach(() => vi.restoreAllMocks());
function request(body: unknown, auth = true) { return new NextRequest("http://localhost:3000/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", ...(auth ? { Authorization: `Bearer ${rawKey}` } : {}) }, body: JSON.stringify(body) }); }
function fixture(scopes: string | null) {
  vi.spyOn(apiKeys, "verifyApiKey").mockResolvedValue({ walletAddress: owner, keyId: "fixture-key", scopes, sourceIds: null });
  const get = vi.fn().mockResolvedValue({ profile: null, activity: { questions: 0 } }), update = vi.fn().mockImplementation(async (_owner, input) => ({ wallet: owner, ...input }));
  const db = vi.spyOn(database, "getDb").mockResolvedValue({ privateProfiles: { get, update, delete: vi.fn() } } as unknown as Awaited<ReturnType<typeof database.getDb>>);
  return { get, update, db };
}
it("profile-only key works on stateless remote MCP without acquiring ask scope", async () => {
  const f = fixture("profile:read"); const response = await POST(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "profile_read", arguments: {} } }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); const body = await response.json(); expect(body.result.isError).not.toBe(true); expect(f.get).toHaveBeenCalledWith(owner, expect.any(String));
  f.db.mockClear(); const denied = await POST(request([{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "profile_read", arguments: {} } }, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "research", arguments: { question: "Do not execute research" } } }]));
  expect(denied.status).toBe(403); expect(f.db).not.toHaveBeenCalled();
});
it.each([null, "ask", "export"])("historical key cannot acquire profile access (%s)", async scopes => {
  const f = fixture(scopes); const response = await POST(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "profile_read", arguments: {} } }));
  if (response.status === 200) expect((await response.json()).result.isError).toBe(true); else expect(response.status).toBe(403);
  expect(f.get).not.toHaveBeenCalled(); expect(f.db).not.toHaveBeenCalled();
});
it("anonymous profile access refuses without a database operation", async () => {
  const f = fixture("profile:read"); const response = await POST(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "profile_read", arguments: { wallet: owner } } }, false));
  expect(response.status).toBe(200); expect((await response.json()).result.isError).toBe(true); expect(f.db).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled();
});
