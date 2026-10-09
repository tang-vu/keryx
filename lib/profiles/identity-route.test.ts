import { describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import { identityCookieName } from "./identity-flow";
import { createIdentityRoutes } from "./identity-route";
import { ProfileIdentityError } from "./verified-identities";
const wallet = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, currentId = "c".repeat(64), rawKey = `kx_live_${"1".repeat(96)}`;
const clock = Date.parse("2026-10-09T06:00:00.000Z");
const headers = { Origin: "https://keryx.cc", "X-Keryx-Expected-Wallet": wallet };
const request = (path: string, method = "GET", extra: Record<string, string> = {}) => new Request(`https://keryx.cc/api/me/profile/identities${path}`, { method, headers: { ...headers, ...extra } });
function fixture() {
  let state = "pending", now = clock;
  const identity = { provider: "github" as const, externalId: "123", label: "alice" };
  const store = { list: vi.fn(async (owner: string) => ({ wallet: owner, identities: [] })),
    begin: vi.fn(async () => { state = "pending"; }),
    consume: vi.fn(async () => { if (state !== "pending") throw new ProfileIdentityError("identity_expired"); state = "consumed"; }),
    complete: vi.fn(async () => { if (state !== "consumed") throw new ProfileIdentityError("identity_expired"); state = "complete"; return { ...identity, wallet, verifiedAt: new Date(now).toISOString() }; }),
    unlink: vi.fn(async () => { state = "unlinked"; }) };
  const db = { profileIdentities: store, incrementUsage: vi.fn() } as unknown as KeryxDB;
  const session = vi.fn().mockResolvedValue({ db, wallet, currentId }), key = vi.fn().mockResolvedValue({ walletAddress: bob, scopes: "profile:read", keyId: "key-bob" });
  const exchange = vi.fn().mockResolvedValue(identity), provider = vi.fn((p: string) => ({ provider: p as "github", clientId: "client", clientSecret: "secret", redirectUri: `https://keryx.cc/api/me/profile/identities/${p}/callback` }));
  const routes = createIdentityRoutes({ session, key, db: async () => db, secret: "s".repeat(48), provider, now: () => now, exchange });
  return { routes, db, store, session, key, exchange, provider, advance() { now += 300001; } };
}
async function started(f: ReturnType<typeof fixture>) {
  const response = await f.routes.START(request("/github/start", "POST"), "github");
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0], url = new URL((await response.json()).authorizationUrl);
  return { cookie, state: url.searchParams.get("state")!, callback: request(`/github/callback?code=secret-code&state=${url.searchParams.get("state")}`, "GET", { Cookie: cookie }) };
}
describe("identity owner/OAuth route gates", () => {
  it("read permission is explicit and malformed/revoked bearer never falls back to a cookie", async () => {
    for (const scopes of [null, "ask,export", "profile:write", "history:read", ""]) {
      const f = fixture(); f.key.mockResolvedValue({ walletAddress: bob, scopes, keyId: "key-bob" });
      expect((await f.routes.GET(request("", "GET", { Authorization: `Bearer ${rawKey}`, "X-Keryx-Expected-Wallet": bob }))).status).toBe(403);
      expect(f.store.list).not.toHaveBeenCalled(); expect(f.session).not.toHaveBeenCalled();
    }
    const f = fixture(); f.key.mockResolvedValue(null);
    expect((await f.routes.GET(request("", "GET", { Authorization: `Bearer ${rawKey}` }))).status).toBe(401);
    expect((await f.routes.GET(request("", "GET", { Authorization: "Basic invalid" }))).status).toBe(401);
    expect(f.session).not.toHaveBeenCalled();
  });
  it("keys read only independently verified owner and record use; no query selector", async () => {
    const f = fixture();
    const response = await f.routes.GET(request("", "GET", { Authorization: `Bearer ${rawKey}`, "X-Keryx-Expected-Wallet": bob }));
    expect(await response.json()).toEqual({ wallet: bob, identities: [] }); expect(f.store.list).toHaveBeenCalledWith(bob);
    expect(f.db.incrementUsage).toHaveBeenCalledWith("key-bob");
    expect((await f.routes.GET(request(`?wallet=${bob}`))).status).toBe(400);
  });
  it("start/unlink are interactive, exact-origin, comparison-bound, saved-profile gated", async () => {
    const f = fixture();
    for (const method of ["START", "DELETE"] as const) {
      const verb = method === "START" ? "POST" : "DELETE";
      expect((await f.routes[method](request("/github", verb, { Origin: "https://evil.org" }), "github")).status).toBe(403);
      expect((await f.routes[method](request("/github", verb, { "X-Keryx-Expected-Wallet": bob }), "github")).status).toBe(409);
      expect((await f.routes[method](request("/github", verb, { Authorization: `Bearer ${rawKey}` }), "github")).status).toBe(403);
      expect((await f.routes[method](new Request("https://keryx.cc/api/me/profile/identities/github", { method: verb, headers: { Origin: headers.Origin } }), "github")).status).toBe(428);
    }
    expect(f.store.begin).not.toHaveBeenCalled(); expect(f.store.unlink).not.toHaveBeenCalled();
    f.store.begin.mockRejectedValue(new ProfileIdentityError("profile_required"));
    expect((await f.routes.START(request("/github/start", "POST"), "github")).status).toBe(409);
    expect(f.exchange).not.toHaveBeenCalled();
  });
  it("sealed absent/rejecting capability refuses before provider configuration or network", async () => {
    const f = fixture(); Object.defineProperty(f.db, "profileIdentities", { get() { throw new Error("sealed"); } });
    expect((await f.routes.GET(request(""))).status).toBe(503);
    expect((await f.routes.START(request("/github/start", "POST"), "github")).status).toBe(503);
    expect(f.provider).not.toHaveBeenCalled(); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("valid single-use callback revalidates session and redirects with no secret or identity", async () => {
    const f = fixture(), flow = await started(f), response = await f.routes.CALLBACK(flow.callback, "github");
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("https://keryx.cc/me/profile?identity=verified");
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(f.exchange).toHaveBeenCalledOnce(); expect(f.store.consume.mock.invocationCallOrder[0]).toBeLessThan(f.exchange.mock.invocationCallOrder[0]);
    expect(f.store.complete).toHaveBeenCalledOnce(); expect(f.session).toHaveBeenCalledTimes(3);
    expect((await f.routes.CALLBACK(flow.callback, "github")).headers.get("location")).toContain("identity=failed");
    expect(f.exchange).toHaveBeenCalledOnce();
  });
  it.each(["wrong-state", "missing-cookie", "wrong-provider", "duplicate-state", "wrong-owner", "wrong-session", "expired", "revoked"])("%s fails before exchange", async fault => {
    const f = fixture(), flow = await started(f); let callback = flow.callback, provider = "github";
    if (fault === "wrong-state") callback = request("/github/callback?code=secret&state=" + "x".repeat(43), "GET", { Cookie: flow.cookie });
    if (fault === "missing-cookie") callback = request(`/github/callback?code=secret&state=${flow.state}`);
    if (fault === "wrong-provider") { provider = "orcid"; callback = request(`/orcid/callback?code=secret&state=${flow.state}`, "GET", { Cookie: flow.cookie.replace(identityCookieName("github"), identityCookieName("orcid")) }); }
    if (fault === "duplicate-state") callback = request(`/github/callback?code=secret&state=${flow.state}&state=${flow.state}`, "GET", { Cookie: flow.cookie });
    if (fault === "wrong-owner") f.session.mockResolvedValue({ db: f.db, wallet: bob, currentId });
    if (fault === "wrong-session") f.session.mockResolvedValue({ db: f.db, wallet, currentId: "d".repeat(64) });
    if (fault === "expired") f.advance();
    if (fault === "revoked") f.session.mockResolvedValue(Response.json({}, { status: 401 }));
    expect((await f.routes.CALLBACK(callback, provider)).headers.get("location")).toContain("identity=failed");
    expect(f.exchange).not.toHaveBeenCalled(); expect(f.store.complete).not.toHaveBeenCalled();
  });
  it("denial consumes a valid callback without provider I/O or leaking provider error", async () => {
    const f = fixture(), flow = await started(f), response = await f.routes.CALLBACK(request(`/github/callback?state=${flow.state}&error=access_denied&error_description=private-secret`, "GET", { Cookie: flow.cookie }), "github");
    expect(f.store.consume).toHaveBeenCalledOnce(); expect(f.exchange).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://keryx.cc/me/profile?identity=failed");
  });
  it("unlink while provider exchange is in flight prevents completion", async () => {
    const f = fixture(), flow = await started(f); let release!: () => void;
    f.exchange.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return { provider: "github", externalId: "123", label: "alice" }; });
    const completion = f.routes.CALLBACK(flow.callback, "github");
    await vi.waitFor(() => expect(f.exchange).toHaveBeenCalledOnce());
    expect((await f.routes.DELETE(request("/github", "DELETE"), "github")).status).toBe(200);
    release(); expect((await completion).headers.get("location")).toContain("identity=failed");
  });
  it("post-exchange revoked session/provider mismatch/expiry cannot write identity", async () => {
    for (const fault of ["revoked", "mismatch", "expiry"]) {
      const f = fixture(), flow = await started(f);
      f.exchange.mockImplementation(async () => {
        if (fault === "revoked") f.session.mockResolvedValue(Response.json({}, { status: 401 }));
        if (fault === "expiry") f.advance();
        return { provider: fault === "mismatch" ? "orcid" : "github", externalId: "123", label: "alice" };
      });
      expect((await f.routes.CALLBACK(flow.callback, "github")).headers.get("location")).toContain("identity=failed");
      expect(f.store.complete).not.toHaveBeenCalled();
    }
  });
});
