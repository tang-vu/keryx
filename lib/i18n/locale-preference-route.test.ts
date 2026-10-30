import { describe, expect, it, vi } from "vitest";
import { accountLocaleKey, configuredLocaleOrigin, createLocalePreferenceRoute, enrolledSqliteLocalePort } from "./locale-preference-route";
import { encodeLocaleValue } from "./locale-preference";
import type { KeryxDB } from "../db/keryx-db";

// No DB driver imports or real database calls in these route fixtures.
vi.mock("../db/application-storage", () => ({ applicationSqliteIdentity() { throw new Error("Unproven facade"); } }));
const owner = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, origin = "https://keryx.test", network = "eip155:5042";
function fixture() {
  const db = {} as KeryxDB, values = new Map<string, string>();
  const session = vi.fn(async () => ({ db, wallet: owner, currentId: "current-session-selector" }));
  const read = vi.fn(async (key: string) => values.get(key) ?? null);
  const write = vi.fn(async (key: string, value: string) => { values.set(key, value); });
  const port = vi.fn(async () => ({ read, write }));
  const handle = createLocalePreferenceRoute({ origin, network, session, port });
  return { handle, db, values, session, read, write, port };
}
function request(method = "GET", extra: Record<string, string> = {}, body = '{"version":1,"locale":"vi"}') {
  return new Request(`${origin}/api/me/locale-preference`, { method, headers: { "Origin": origin, "Sec-Fetch-Site": "same-origin",
    "X-Keryx-Expected-Wallet": owner, "X-Keryx-Locale-Network": network, "Content-Type": "application/json", ...extra }, ...(method === "PUT" ? { body } : {}) });
}
describe("private locale route", () => {
  it("derives a canonical origin only from a bounded configured base, never request Host", () => {
    expect(configuredLocaleOrigin(`${origin}/`)).toBe(origin);
    for (const base of [`${origin}/path`, `${origin}?query`, "https://user:pass@keryx.test", ` ${origin}`, "file:///private"]) expect(configuredLocaleOrigin(base)).toBeNull();
  });
  it("rejects every Authorization header, bad origin/network and missing expected owner before session/port/body", async () => {
    const cases: Record<string, string>[] = [{ Authorization: "Bearer malformed" }, { Authorization: "" }, { Origin: "https://evil.test" },
      { "Sec-Fetch-Site": "cross-site" }, { "X-Keryx-Expected-Wallet": "" }, { "X-Keryx-Locale-Network": "eip155:5042002" }];
    for (const extra of cases) {
      const f = fixture(), req = request("PUT", extra), body = vi.spyOn(req, "body", "get");
      expect((await f.handle(req)).status).not.toBe(200); expect(f.session).not.toHaveBeenCalled();
      expect(f.port).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled();
    }
  });
  it("admits a browser GET without Origin only with exact same-origin Fetch Metadata", async () => {
    const f = fixture(), req = request(); req.headers.delete("origin");
    expect((await f.handle(req)).status).toBe(200);
    req.headers.delete("sec-fetch-site"); expect((await f.handle(req)).status).toBe(403);
  });
  it("does not load a port or private body when authentication/owner binding fails", async () => {
    const f = fixture(); f.session.mockResolvedValueOnce(new Response(null, { status: 401 }) as never);
    const req = request("PUT"), body = vi.spyOn(req, "body", "get");
    expect((await f.handle(req)).status).toBe(401); expect(f.port).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled();
    f.session.mockResolvedValueOnce({ db: f.db, wallet: bob, currentId: "other" });
    expect((await f.handle(request("PUT"))).status).toBe(409); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["vi", "ru", "ar"] as const)("stores %s as a tiny scalar in a locale-only server-owner/network/configured-origin namespace", async locale => {
    const f = fixture(); const response = await f.handle(request("PUT", {}, JSON.stringify({ version: 1, locale })));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const key = accountLocaleKey(origin, network, owner);
    expect(f.write).toHaveBeenCalledWith(key, encodeLocaleValue(locale));
    expect(key).not.toContain("current-session-selector"); expect(key).not.toContain("registry");
    expect(accountLocaleKey(origin, network, bob)).not.toBe(key);
    expect(accountLocaleKey(origin, "eip155:5042002", owner)).not.toBe(key);
    expect(accountLocaleKey("https://other.test", network, owner)).not.toBe(key);
    const retained = await f.handle(request());
    expect(retained.status).toBe(200);
    expect(await retained.json()).toMatchObject({ version: 1, locale, owner, origin, network });
  });
  it("refuses unsupported/sealed/unknown facades without a storage fallback", async () => {
    const f = fixture(); f.port.mockResolvedValueOnce(null as never);
    expect((await f.handle(request("PUT"))).status).toBe(503); expect(f.read).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    expect(await enrolledSqliteLocalePort({} as KeryxDB, "write", network)).toBeNull();
  });
  it("refuses corrupt values, read failures, thrown writes and unacknowledged writes honestly", async () => {
    const f = fixture(); f.values.set(accountLocaleKey(origin, network, owner), "corrupt");
    expect((await f.handle(request("PUT"))).status).toBe(503); expect(f.write).not.toHaveBeenCalled();
    f.values.clear(); f.read.mockRejectedValueOnce(new Error("private backend detail"));
    const failedRead = await f.handle(request()); expect(failedRead.status).toBe(503); expect(await failedRead.text()).not.toContain("private backend detail");
    f.write.mockRejectedValueOnce(new Error("refused")); expect((await f.handle(request("PUT"))).status).toBe(503);
    f.write.mockImplementationOnce(async () => {}); expect((await f.handle(request("PUT"))).status).toBe(503);
  });
  it("refuses oversized/invalid/extra-owner bodies and a session change before write", async () => {
    for (const body of ['{"version":1,"locale":"vi","owner":"body-owner"}', '{"version":2,"locale":"vi"}', '{"version":1,"locale":"zh-TW"}',
      '{"version":1,"locale":"ru-RU"}', '{"version":1,"locale":"ru-Latn"}', " ".repeat(65)]) {
      const f = fixture(); expect((await f.handle(request("PUT", {}, body))).status).toBe(400); expect(f.write).not.toHaveBeenCalled();
    }
    const f = fixture(); f.session.mockResolvedValueOnce({ db: f.db, wallet: owner, currentId: "old" }).mockResolvedValueOnce({ db: f.db, wallet: owner, currentId: "new" });
    expect((await f.handle(request("PUT"))).status).toBe(409); expect(f.write).not.toHaveBeenCalled();
  });
  it("does not publish a late read/write response after logout or session rotation", async () => {
    const f = fixture(); f.session.mockResolvedValueOnce({ db: f.db, wallet: owner, currentId: "old" }).mockResolvedValueOnce({ db: f.db, wallet: owner, currentId: "old" }).mockResolvedValueOnce(new Response(null, { status: 401 }) as never);
    const response = await f.handle(request("PUT")); expect(f.write).toHaveBeenCalledTimes(1); expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
