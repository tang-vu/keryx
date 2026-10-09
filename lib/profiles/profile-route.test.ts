import { describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import { createProfileRoutes } from "./profile-route";
import { PrivateProfileError } from "./private-profile";
import { DatabaseSync } from "node:sqlite";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqlitePrivateProfiles } from "../db/private-profiles-sqlite";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, rawKey = `kx_live_${"1".repeat(96)}`;
const input = { displayName: "Alice", handle: "reader_01", bio: "Reader", purpose: "Papers", links: [] };
const cookieHeaders = { Origin: "https://keryx.cc", "X-Keryx-Expected-Wallet": alice };
const request = (method = "GET", body?: unknown, headers: Record<string, string> = {}) => new Request("https://keryx.cc/api/me/profile", { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
function fixture(scopes: string | null = "profile:read,profile:write") {
  const store = { get: vi.fn().mockResolvedValue({ profile: null, activity: {} }), update: vi.fn().mockResolvedValue({ wallet: alice, ...input }), delete: vi.fn().mockResolvedValue(undefined) };
  const db = { privateProfiles: store } as unknown as KeryxDB, session = vi.fn().mockResolvedValue({ db, wallet: alice });
  const key = vi.fn().mockResolvedValue({ walletAddress: bob, scopes }), database = vi.fn().mockResolvedValue(db);
  return { store, db, key, session, database, routes: createProfileRoutes({ session, key, db: database, network: "eip155:5042" }) };
}
describe("owner private profile API", () => {
  it("anonymous session requests refuse and never reach profile storage", async () => { const f = fixture(); f.session.mockResolvedValue(Response.json({}, { status: 401 })); expect((await f.routes.GET(request())).status).toBe(401); expect(f.store.get).not.toHaveBeenCalled(); });
  it("active SIWE reads its own profile and responses are no-store", async () => { const f = fixture(), response = await f.routes.GET(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(f.store.get).toHaveBeenCalledWith(alice, "eip155:5042"); });
  it.each([null, "ask", "export", "", "unknown"])("old/default/no-profile key cannot read or write (%s)", async scopes => { const f = fixture(scopes), headers = { Authorization: `Bearer ${rawKey}` }; expect((await f.routes.GET(request("GET", undefined, headers))).status).toBe(403); expect((await f.routes.PUT(request("PUT", input, headers))).status).toBe(403); expect(f.store.get).not.toHaveBeenCalled(); expect(f.store.update).not.toHaveBeenCalled(); expect(f.database).not.toHaveBeenCalled(); });
  it("read and write scopes do not imply one another", async () => { const f = fixture("profile:read"); expect((await f.routes.DELETE(request("DELETE", undefined, { Authorization: `Bearer ${rawKey}` }))).status).toBe(403); const g = fixture("profile:write"); expect((await g.routes.GET(request("GET", undefined, { Authorization: `Bearer ${rawKey}` }))).status).toBe(403); });
  it("API-key owner overrides a different browser session, and no arbitrary wallet selector is accepted", async () => { const f = fixture(), headers = { Authorization: `Bearer ${rawKey}` }; expect((await f.routes.PUT(request("PUT", input, headers))).status).toBe(200); expect(f.store.update).toHaveBeenCalledWith(bob, input); expect(f.session).not.toHaveBeenCalled(); expect((await f.routes.PUT(request("PUT", { ...input, wallet: alice }, headers))).status).toBe(400); expect((await f.routes.GET(new Request("https://keryx.cc/api/me/profile?wallet=" + alice, { headers }))).status).toBe(400); });
  it("revoked/malformed bearer never falls back to an authenticated cookie", async () => { const f = fixture(); f.key.mockResolvedValue(null); expect((await f.routes.GET(request("GET", undefined, { Authorization: `Bearer ${rawKey}` }))).status).toBe(401); expect((await f.routes.GET(request("GET", undefined, { Authorization: "Basic invalid" }))).status).toBe(401); expect(f.session).not.toHaveBeenCalled(); });
  it("cookie mutations require exact same origin before session lookup or write", async () => { const f = fixture(); for (const origin of [undefined, "https://evil.org", "http://keryx.cc"]) expect((await f.routes.PUT(request("PUT", input, origin ? { Origin: origin } : {}))).status).toBe(403); expect(f.session).not.toHaveBeenCalled(); expect((await f.routes.PUT(request("PUT", input, cookieHeaders))).status).toBe(200); });
  it("delete acts only on authenticated owner and never rewrites history", async () => { const f = fixture(); expect((await f.routes.DELETE(request("DELETE", undefined, cookieHeaders))).status).toBe(200); expect(f.store.delete).toHaveBeenCalledWith(alice); expect(f.store.update).not.toHaveBeenCalled(); });
  it("collisions are non-identifying and sealed capability failures have explicit availability", async () => { const f = fixture(); f.store.update.mockRejectedValue(new PrivateProfileError("handle_conflict")); const result = await f.routes.PUT(request("PUT", input, cookieHeaders)); expect(result.status).toBe(409); expect(JSON.stringify(await result.json())).not.toContain(bob); Object.defineProperty(f.db, "privateProfiles", { get() { throw new Error("sealed"); } }); expect((await f.routes.GET(request())).status).toBe(503); });
  it("rejects oversized, invalid UTF-8 and non-object bodies before update", async () => { const f = fixture(); for (const body of [JSON.stringify({ ...input, bio: "a".repeat(9000) }), "[]", new Uint8Array([0xff])]) { const req = new Request("https://keryx.cc/api/me/profile", { method: "PUT", headers: { ...cookieHeaders, "Content-Type": "application/json" }, body }); expect((await f.routes.PUT(req)).status).toBe(400); } expect(f.store.update).not.toHaveBeenCalled(); });
  it.each(["PUT", "DELETE"])("cookie %s requires a valid comparison-only owner precondition before session/storage", async method => {
    const f = fixture(), call = () => method === "PUT" ? f.routes.PUT : f.routes.DELETE;
    expect((await call()(request(method, method === "PUT" ? input : undefined, { Origin: cookieHeaders.Origin }))).status).toBe(428);
    for (const expected of ["", "not-a-wallet", "0x1234"]) expect((await call()(request(method, method === "PUT" ? input : undefined, { ...cookieHeaders, "X-Keryx-Expected-Wallet": expected }))).status).toBe(400);
    expect(f.session).not.toHaveBeenCalled(); expect(f.store.update).not.toHaveBeenCalled(); expect(f.store.delete).not.toHaveBeenCalled();
  });
  it("a stale Alice editor cannot PUT or DELETE Bob's authenticated cookie profile; neither stored row changes", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      installSqliteApplicationSchema(sqlite); const port = createSqlitePrivateProfiles(sqlite);
      await port.update(alice, input); await port.update(bob, { ...input, displayName: "Bob", handle: "bob_reader" });
      const before = JSON.stringify(sqlite.prepare("SELECT * FROM private_profiles ORDER BY wallet").all());
      const db = {} as KeryxDB, profileRead = vi.fn(() => port); Object.defineProperty(db, "privateProfiles", { get: profileRead });
      const session = vi.fn().mockResolvedValue({ db, wallet: bob }), key = vi.fn(), database = vi.fn();
      const routes = createProfileRoutes({ session, key, db: database, network: "eip155:5042" });
      for (const response of [await routes.PUT(request("PUT", { ...input, bio: "Stale replacement" }, cookieHeaders)), await routes.DELETE(request("DELETE", undefined, cookieHeaders))]) {
        expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("wallet");
      }
      expect(profileRead).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(database).not.toHaveBeenCalled();
      expect(JSON.stringify(sqlite.prepare("SELECT * FROM private_profiles ORDER BY wallet").all())).toBe(before);
    } finally { sqlite.close(); }
  });
  it("a key's optional precondition only compares its independently verified owner and never grants scopes", async () => {
    const f = fixture("profile:write"), headers = { Authorization: `Bearer ${rawKey}`, "X-Keryx-Expected-Wallet": alice };
    expect((await f.routes.PUT(request("PUT", input, headers))).status).toBe(409); expect((await f.routes.DELETE(request("DELETE", undefined, headers))).status).toBe(409);
    expect(f.database).not.toHaveBeenCalled(); expect(f.session).not.toHaveBeenCalled();
    expect((await f.routes.PUT(request("PUT", input, { ...headers, "X-Keryx-Expected-Wallet": bob.toUpperCase().replace("0X", "0x") }))).status).toBe(200); expect(f.store.update).toHaveBeenCalledWith(bob, input);
    const legacy = fixture(null); expect((await legacy.routes.PUT(request("PUT", input, { ...headers, "X-Keryx-Expected-Wallet": bob }))).status).toBe(403); expect(legacy.database).not.toHaveBeenCalled();
  });
  it("optional GET precondition withholds distinct Bob activity from an Alice editor even when Bob has no profile", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      installSqliteApplicationSchema(sqlite); const port = createSqlitePrivateProfiles(sqlite);
      sqlite.prepare("INSERT INTO query_runs(id,asker,origin,data) VALUES(?,?,?,?)").run("bob-recorded-run", bob, "mcp", "{}");
      const db = {} as KeryxDB, profileRead = vi.fn(() => port); Object.defineProperty(db, "privateProfiles", { get: profileRead });
      const routes = createProfileRoutes({ session: async () => ({ db, wallet: bob }), key: vi.fn(), db: vi.fn(), network: "eip155:5042" });
      const rejected = await routes.GET(request("GET", undefined, { "X-Keryx-Expected-Wallet": alice }));
      expect(rejected.status).toBe(409); expect(JSON.stringify(await rejected.json())).not.toContain(bob); expect(profileRead).not.toHaveBeenCalled();
      for (const headers of [{}, { "X-Keryx-Expected-Wallet": bob }] as Record<string, string>[]) { const own = await routes.GET(request("GET", undefined, headers)); expect(own.status).toBe(200); expect(await own.json()).toMatchObject({ profile: null, activity: { questions: 1, surfacesUsed: ["mcp"] } }); }
    } finally { sqlite.close(); }
    const keyed = fixture("profile:read"); expect((await keyed.routes.GET(request("GET", undefined, { Authorization: `Bearer ${rawKey}`, "X-Keryx-Expected-Wallet": alice }))).status).toBe(409); expect(keyed.database).not.toHaveBeenCalled();
    expect((await keyed.routes.GET(request("GET", undefined, { Authorization: `Bearer ${rawKey}`, "X-Keryx-Expected-Wallet": "malformed" }))).status).toBe(400);
  });
  it("the bounded body refuses at its read deadline even if cancellation never settles", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(), cancel = vi.fn(() => new Promise<void>(() => undefined));
      const body = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined), cancel });
      const pending = f.routes.PUT(new Request("https://keryx.cc/api/me/profile", { method: "PUT", body, duplex: "half", headers: { ...cookieHeaders, "Content-Type": "application/json" } } as RequestInit));
      await vi.advanceTimersByTimeAsync(5001); expect((await pending).status).toBe(400); expect(cancel).toHaveBeenCalledOnce(); expect(f.store.update).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
