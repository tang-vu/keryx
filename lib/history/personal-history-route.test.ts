import { expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import { createHistoryRoute } from "./personal-history-route";
import { parseScopes, normalizeScopes } from "../api-key-scopes";
const owner = `0x${"a".repeat(40)}`, keyOwner = `0x${"b".repeat(40)}`, raw = `kx_live_${"1".repeat(96)}`;
const request = (query = "", auth?: string, expected?: string) => new Request("https://synthetic.example/api/me/history" + query, { headers: { ...(auth === undefined ? {} : { Authorization: auth }), ...(expected ? { "X-Keryx-Expected-Wallet": expected } : {}) } });
function fixture(scopes: string | null = "history:read") {
  const list = vi.fn().mockResolvedValue([]), db = { personalHistory: { list } } as unknown as KeryxDB;
  const key = vi.fn().mockResolvedValue({ walletAddress: keyOwner, scopes }), session = vi.fn().mockResolvedValue({ db, wallet: owner }), database = vi.fn().mockResolvedValue(db);
  return { list, key, session, database, db, route: createHistoryRoute({ key, session, db: database, network: "eip155:5042002" }) };
}
it("SIWE and explicit history key use their own authenticated owner and no-store responses", async () => {
  const f = fixture(); const cookie = await f.route(request()); expect(cookie.status).toBe(200); expect(cookie.headers.get("cache-control")).toBe("no-store"); expect((await cookie.json()).wallet).toBe(owner);
  const key = await f.route(request("", `Bearer ${raw}`)); expect(key.status).toBe(200); expect((await key.json()).wallet).toBe(keyOwner); expect(f.list).toHaveBeenLastCalledWith(keyOwner, expect.objectContaining({ take: 26 }));
});
it.each([null, "", "ask", "export", "profile:read", "profile:write", "unknown"])("legacy and other scopes do not acquire history access (%s)", async scopes => {
  const f = fixture(scopes); expect((await f.route(request("", `Bearer ${raw}`))).status).toBe(403); expect(f.list).not.toHaveBeenCalled(); expect(f.database).not.toHaveBeenCalled(); expect(f.session).not.toHaveBeenCalled();
});
it("new rights never enter default scope normalization", () => {
  for (const input of [undefined, null, "", "unknown"]) expect(parseScopes(input)).toEqual(["ask", "export"]);
  for (const input of [undefined, [], ["unknown"]]) expect(normalizeScopes(input)).toEqual(["ask", "export"]);
  expect(normalizeScopes(["history:read"])).toEqual(["history:read"]);
});
it("revoked and malformed bearer cannot fall back to a valid session", async () => {
  const f = fixture(); f.key.mockResolvedValue(null);
  for (const header of [`Bearer ${raw}`, "Basic invalid", "Bearer invalid"]) expect((await f.route(request("", header))).status).toBe(401);
  expect(f.session).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled();
});
it("owner comparison, strict selectors and missing/sealed capability refuse before history I/O", async () => {
  const f = fixture(); expect((await f.route(request("", undefined, keyOwner))).status).toBe(409);
  expect((await f.route(request("?wallet=" + keyOwner))).status).toBe(400);
  expect(f.list).not.toHaveBeenCalled();
  Object.defineProperty(f.db, "personalHistory", { get() { throw new Error("sealed"); } });
  expect((await f.route(request())).status).toBe(503);
});
it.each(["from=garbage", "to=2026-99-99T00:00:00.000Z", "from=2026-02-30T00:00:00.000Z"])("malformed/out-of-range dates are 400 before authentication or storage (%s)", async query => {
  const f = fixture(); expect((await f.route(request("?" + query))).status).toBe(400);
  expect(f.key).not.toHaveBeenCalled(); expect(f.session).not.toHaveBeenCalled(); expect(f.database).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled();
});
