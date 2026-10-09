import { describe, expect, it, vi } from "vitest";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { NextRequestAdapter } from "next/dist/server/web/spec-extension/adapters/next-request";
import { NodeNextRequest } from "next/dist/server/base-http/node";
import type { KeryxDB } from "../db/keryx-db";
import { identityCookieName } from "./identity-flow";
import { createIdentityRoutes } from "./identity-route";
import type { ProviderConfiguration } from "./identity-provider";
import { ProfileIdentityError } from "./verified-identities";
const wallet = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, currentId = "c".repeat(64), rawKey = `kx_live_${"1".repeat(96)}`;
const clock = Date.parse("2026-10-09T06:00:00.000Z");
const headers = { Origin: "https://keryx.cc", "X-Keryx-Expected-Wallet": wallet };
const request = (path: string, method = "GET", extra: Record<string, string> = {}) => new Request(`https://keryx.cc/api/me/profile/identities${path}`, { method, headers: { ...headers, ...extra } });
const internalRequest = (path: string, method = "GET", extra: Record<string, string> = {}) => new Request(`http://127.0.0.1:3939/api/me/profile/identities${path}`, { method, headers: { ...headers, ...extra } });
function fixture(options: { applicationOrigin?: string } = { applicationOrigin: headers.Origin }) {
  let state = "pending", now = clock;
  const identity = { provider: "github" as const, externalId: "123", label: "alice" };
  const store = { list: vi.fn(async (owner: string) => ({ wallet: owner, identities: [] })),
    begin: vi.fn(async () => { state = "pending"; }),
    consume: vi.fn(async () => { if (state !== "pending") throw new ProfileIdentityError("identity_expired"); state = "consumed"; }),
    complete: vi.fn(async () => { if (state !== "consumed") throw new ProfileIdentityError("identity_expired"); state = "complete"; return { ...identity, wallet, verifiedAt: new Date(now).toISOString() }; }),
    unlink: vi.fn(async () => { state = "unlinked"; }) };
  const db = { profileIdentities: store, incrementUsage: vi.fn() } as unknown as KeryxDB;
  const session = vi.fn().mockResolvedValue({ db, wallet, currentId }), key = vi.fn().mockResolvedValue({ walletAddress: bob, scopes: "profile:read", keyId: "key-bob" });
  const exchange = vi.fn().mockResolvedValue(identity), provider = vi.fn((p: string): ProviderConfiguration | null => ({ provider: p as "github", clientId: "client", clientSecret: "secret", redirectUri: `https://keryx.cc/api/me/profile/identities/${p}/callback` }));
  const dbGetter = vi.fn(async () => db);
  const routes = createIdentityRoutes({ session, key, db: dbGetter, secret: "s".repeat(48), provider, applicationOrigin: options.applicationOrigin, now: () => now, exchange });
  return { routes, db, dbGetter, store, session, key, exchange, provider, advance() { now += 300001; } };
}
async function started(f: ReturnType<typeof fixture>) {
  const response = await f.routes.START(request("/github/start", "POST"), "github");
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0], url = new URL((await response.json()).authorizationUrl);
  return { cookie, state: url.searchParams.get("state")!, callback: request(`/github/callback?code=secret-code&state=${url.searchParams.get("state")}`, "GET", { Cookie: cookie }) };
}
describe("identity owner/OAuth route gates", () => {
  it.each(["START", "DELETE"] as const)("%s admits actual Next zero-byte body streams to existing SIWE authentication", async method => {
    const f = fixture(); f.session.mockResolvedValue(Response.json({ error: "Sign in to access your account." }, { status: 401 }));
    const socket = new Socket(), incoming = new IncomingMessage(socket);
    incoming.method = method === "START" ? "POST" : "DELETE"; incoming.url = "http://127.0.0.1:3939/api/me/profile/identities/github";
    incoming.headers = { origin: headers.Origin, "x-keryx-expected-wallet": wallet, "content-length": "0" }; incoming.push(null);
    const target = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), new AbortController().signal);
    try {
      expect(target.body).not.toBeNull(); const response = await f.routes[method](target, "github");
      expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "Sign in to access your account." });
      expect(f.session).toHaveBeenCalledOnce(); expect(f.dbGetter).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
      expect(f.store.begin).not.toHaveBeenCalled(); expect(f.store.unlink).not.toHaveBeenCalled(); expect(f.exchange).not.toHaveBeenCalled();
    } finally { socket.destroy(); }
  });
  it("streamed payload cannot use Content-Length zero to cross request or dependency gates", async () => {
    for (const method of ["START", "DELETE"] as const) for (const payload of [" ", "{}"])
      for (const origin of [headers.Origin, "https://foreign.synthetic.invalid"]) {
        const f = fixture(), target = new Request("http://127.0.0.1:3939/api/me/profile/identities/github", {
          method: method === "START" ? "POST" : "DELETE", headers: { ...headers, Origin: origin, "Content-Length": "0" }, body: payload,
        });
        const response = await f.routes[method](target, "github");
        expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_identity_request" });
        expect(f.session).not.toHaveBeenCalled(); expect(f.key).not.toHaveBeenCalled(); expect(f.dbGetter).not.toHaveBeenCalled();
        expect(f.provider).not.toHaveBeenCalled(); expect(f.store.begin).not.toHaveBeenCalled(); expect(f.store.unlink).not.toHaveBeenCalled();
      }
  });
  it("stream EOF does not bypass the existing foreign Origin fence", async () => {
    for (const method of ["START", "DELETE"] as const) {
      const f = fixture(), target = new Request("http://127.0.0.1:3939/api/me/profile/identities/github", {
        method: method === "START" ? "POST" : "DELETE", headers: { ...headers, Origin: "https://foreign.synthetic.invalid" },
        body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: "half",
      } as RequestInit);
      const response = await f.routes[method](target, "github"); expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "same_origin_required" }); expect(f.session).not.toHaveBeenCalled(); expect(f.dbGetter).not.toHaveBeenCalled();
    }
  });
  it("a stalled stream refuses within five seconds without waiting for cancellation or invoking late dependencies", async () => {
    vi.useFakeTimers();
    try {
      for (const method of ["START", "DELETE"] as const) {
        const f = fixture(), cancel = vi.fn(() => new Promise<void>(() => {}));
        let finish: ((value: void) => void) | undefined;
        const lateProducer = new Promise<void>(resolve => { finish = resolve; });
        const body = new ReadableStream<Uint8Array>({ async pull() { await lateProducer; }, cancel });
        const target = new Request("https://keryx.cc/api/me/profile/identities/github", {
          method: method === "START" ? "POST" : "DELETE", headers, body, duplex: "half",
        } as RequestInit);
        const pending = f.routes[method](target, "github"); await vi.advanceTimersByTimeAsync(5000);
        const response = await pending; expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_identity_request" });
        expect(cancel).toHaveBeenCalledOnce(); finish?.(); await vi.advanceTimersByTimeAsync(1);
        expect(f.session).not.toHaveBeenCalled(); expect(f.dbGetter).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
        expect(f.store.begin).not.toHaveBeenCalled(); expect(f.store.unlink).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
      }
    } finally { vi.useRealTimers(); }
  });
  it("internal Next request URL still admits the configured public origin to session authentication", async () => {
    const f = fixture(); f.session.mockResolvedValue(Response.json({ error: "Sign in to access your account." }, { status: 401 }));
    const response = await f.routes.START(internalRequest("/github/start", "POST"), "github");
    expect(response.status).toBe(401); expect(f.session).toHaveBeenCalledOnce();
    expect(f.store.begin).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  });
  it("internal Next request URL retains the fixed public callback and its owner/state fences", async () => {
    const f = fixture(), flow = await started(f);
    const response = await f.routes.CALLBACK(internalRequest(`/github/callback?code=secret-code&state=${flow.state}`, "GET", { Cookie: flow.cookie }), "github");
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("https://keryx.cc/me/profile?identity=verified");
    expect(f.store.consume).toHaveBeenCalledOnce(); expect(f.exchange).toHaveBeenCalledOnce(); expect(f.store.complete).toHaveBeenCalledOnce();
  });
  it("public Origin reaches authentication regardless of untrusted Host and forwarding headers", async () => {
    const proxies: Record<string, string>[] = [
      {},
      { Host: "keryx.cc", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "keryx.cc" },
      { Host: "evil.org", "X-Forwarded-Proto": "http", "X-Forwarded-Host": "evil.org", Forwarded: "host=evil.org;proto=http" },
    ];
    for (const method of ["START", "DELETE"] as const) for (const proxy of proxies) {
      const f = fixture(); f.session.mockResolvedValue(Response.json({}, { status: 401 }));
      const response = await f.routes[method](internalRequest("/github", method === "START" ? "POST" : "DELETE", proxy), "github");
      expect(response.status).toBe(401); expect(f.session).toHaveBeenCalledOnce();
      expect(f.dbGetter).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
      expect(f.store.begin).not.toHaveBeenCalled(); expect(f.store.unlink).not.toHaveBeenCalled();
    }
  });
  it("a different configured HTTPS deployment and ordinary port remain the exact authority", async () => {
    const applicationOrigin = "https://app.synthetic.invalid:8443", f = fixture({ applicationOrigin });
    f.provider.mockReturnValue({ provider: "github", clientId: "client", clientSecret: "secret", redirectUri: `${applicationOrigin}/api/me/profile/identities/github/callback` });
    const response = await f.routes.START(internalRequest("/github/start", "POST", { Origin: applicationOrigin, Host: "keryx.cc" }), "github");
    expect(response.status).toBe(200);
    expect(new URL((await response.json()).authorizationUrl).searchParams.get("redirect_uri")).toBe(`${applicationOrigin}/api/me/profile/identities/github/callback`);
    const callback = await f.routes.CALLBACK(internalRequest("/github/callback?state=invalid"), "github");
    expect(callback.headers.get("location")).toBe(`${applicationOrigin}/me/profile?identity=failed`);
    expect((await f.routes.DELETE(internalRequest("/github", "DELETE"), "github")).status).toBe(403);
  });
  it("foreign, missing and internal Origin cannot acquire authority from matching URL/Host/proxy metadata", async () => {
    for (const method of ["START", "DELETE"] as const) for (const origin of ["https://evil.org", "http://127.0.0.1:3939", "null", "https://keryx.cc/", null]) {
      const f = fixture(), target = internalRequest("/github", method === "START" ? "POST" : "DELETE", {
        Host: origin === "https://evil.org" ? "evil.org" : "keryx.cc", "X-Forwarded-Host": "keryx.cc", "X-Forwarded-Proto": "https", Forwarded: "host=keryx.cc;proto=https",
      });
      if (origin === null) target.headers.delete("origin"); else target.headers.set("origin", origin);
      const response = await f.routes[method](target, "github");
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "same_origin_required" });
      expect(f.session).not.toHaveBeenCalled(); expect(f.dbGetter).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
      expect(f.store.begin).not.toHaveBeenCalled(); expect(f.store.unlink).not.toHaveBeenCalled();
    }
  });
  it("missing or malformed trusted HTTPS origin fails mutations/callback closed before dependency I/O", async () => {
    for (const applicationOrigin of [undefined, "", "not-a-url", "http://localhost:3939", "http://keryx.cc", "https://keryx.cc/", "https://user:password@keryx.cc", "https://keryx.cc/path", "https://keryx.cc?return=evil", "https://keryx.cc#fragment", "https://KERYX.cc", "https://keryx.cc:443"]) {
      const f = fixture({ applicationOrigin });
      for (const method of ["START", "DELETE", "CALLBACK"] as const) {
        const response = await f.routes[method](internalRequest("/github", method === "START" ? "POST" : method === "DELETE" ? "DELETE" : "GET", {
          Host: "keryx.cc", "X-Forwarded-Host": "keryx.cc", "X-Forwarded-Proto": "https",
        }), "github");
        expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "identity_unavailable" });
        expect(response.headers.get("location")).toBeNull();
      }
      expect(f.session).not.toHaveBeenCalled(); expect(f.dbGetter).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
      for (const operation of Object.values(f.store)) expect(operation).not.toHaveBeenCalled(); expect(f.exchange).not.toHaveBeenCalled();
    }
  });
  it("provider redirect must match the configured origin and exact provider callback path", async () => {
    for (const redirectUri of ["https://evil.org/api/me/profile/identities/github/callback", "http://keryx.cc/api/me/profile/identities/github/callback", "https://keryx.cc/api/me/profile/identities/orcid/callback", "https://keryx.cc/other", "https://keryx.cc/api/me/profile/identities/github/callback?return=evil", "https://keryx.cc/api/me/profile/identities/github/callback#fragment", "not-a-url"]) {
      const f = fixture(); f.provider.mockReturnValue({ provider: "github", clientId: "client", clientSecret: "secret", redirectUri });
      expect((await f.routes.START(internalRequest("/github/start", "POST"), "github")).status).toBe(503);
      f.session.mockClear();
      const callback = await f.routes.CALLBACK(internalRequest("/github/callback?code=secret&state=" + "x".repeat(43)), "github");
      expect(callback.status).toBe(503); expect(callback.headers.get("location")).toBeNull();
      expect(f.session).not.toHaveBeenCalled(); expect(f.store.begin).not.toHaveBeenCalled(); expect(f.store.consume).not.toHaveBeenCalled();
      expect(f.store.complete).not.toHaveBeenCalled(); expect(f.exchange).not.toHaveBeenCalled();
    }
  });
  it("callback failure returns only to configured application origin without requiring browser Origin", async () => {
    const f = fixture(), callback = new Request("http://internal.invalid:3939/api/me/profile/identities/github/callback?code=private&state=invalid", {
      headers: { Host: "evil.org", "X-Forwarded-Host": "evil.org", "X-Forwarded-Proto": "http", Forwarded: "host=evil.org;proto=http" },
    });
    const response = await f.routes.CALLBACK(callback, "github");
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("https://keryx.cc/me/profile?identity=failed");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(f.session).not.toHaveBeenCalled(); expect(f.dbGetter).not.toHaveBeenCalled(); expect(f.store.consume).not.toHaveBeenCalled(); expect(f.exchange).not.toHaveBeenCalled();
  });
  it("credential removal prevents OAuth admission but leaves authenticated unlink and reads available", async () => {
    const f = fixture(); f.provider.mockReturnValue(null);
    expect((await f.routes.START(internalRequest("/github/start", "POST"), "github")).status).toBe(503);
    const callback = await f.routes.CALLBACK(internalRequest("/github/callback?state=invalid"), "github");
    expect(callback.status).toBe(503); expect(callback.headers.get("location")).toBeNull();
    f.provider.mockClear();
    expect((await f.routes.DELETE(internalRequest("/github", "DELETE"), "github")).status).toBe(200);
    expect(f.store.unlink).toHaveBeenCalledWith(wallet, "github"); expect(f.provider).not.toHaveBeenCalled();
    const readWithoutOrigin = fixture({});
    expect((await readWithoutOrigin.routes.GET(internalRequest(""))).status).toBe(200);
    expect(readWithoutOrigin.store.list).toHaveBeenCalledWith(wallet);
  });
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
