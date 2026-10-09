import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../../app/mcp/route";
import * as apiKeys from "../api-keys";
import * as database from "../db";
const raw = `kx_live_${"1".repeat(96)}`, owner = `0x${"a".repeat(40)}`;
afterEach(() => vi.restoreAllMocks());
function request(body: unknown, auth = true) { return new NextRequest("http://localhost:3000/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", ...(auth ? { Authorization: `Bearer ${raw}` } : {}) }, body: JSON.stringify(body) }); }
const call = (id = 1, args = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "history_read", arguments: args } });
function fixture(scopes: string | null) {
  const verify = vi.spyOn(apiKeys, "verifyApiKey").mockResolvedValue({ walletAddress: owner, keyId: "synthetic-key", scopes, sourceIds: null });
  const list = vi.fn().mockResolvedValue([]), usage = vi.fn();
  const db = vi.spyOn(database, "getDb").mockResolvedValue({ personalHistory: { list }, incrementUsage: usage } as unknown as Awaited<ReturnType<typeof database.getDb>>);
  return { list, usage, db, verify };
}
it("history-only remote key reads bounded own history without sponsored research admission or usage", async () => {
  const f = fixture("history:read"), response = await POST(request(call(1, { search: "%_", limit: 3 })));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).result.structuredContent.wallet).toBe(owner);
  expect(f.list).toHaveBeenCalledWith(owner, expect.objectContaining({ take: 4, filters: { search: "%_" } })); expect(f.usage).not.toHaveBeenCalled();
  f.db.mockClear(); const mixed = await POST(request([call(2), { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "research", arguments: { question: "Never run" } } }]));
  expect(mixed.status).toBe(403); expect(f.db).not.toHaveBeenCalled();
});
it.each([null, "ask", "export", "profile:read", "profile:write"])("non-history scopes cannot reach history storage (%s)", async scopes => {
  const f = fixture(scopes), response = await POST(request(call()));
  if (response.status === 200) expect((await response.json()).result.isError).toBe(true); else expect(response.status).toBe(403);
  expect(f.list).not.toHaveBeenCalled(); expect(f.db).not.toHaveBeenCalled();
});
it("anonymous and revoked callers refuse without history I/O; public paper lookup batch grants no authority", async () => {
  const f = fixture("history:read"); const response = await POST(request(call(), false)); expect((await response.json()).result.isError).toBe(true); expect(f.db).not.toHaveBeenCalled();
  f.verify.mockResolvedValue(null); expect((await POST(request(call()))).status).toBe(401); expect(f.db).not.toHaveBeenCalled();
});
