/** AUTHORED, UNRUN. Route assembly fixtures only: the selected getDb resolver is
 * mocked, the existing JWT issuer/verifier and membership factory are genuine.
 * No DB connection, DDL, provider, ENV, signing custody or readiness is exercised. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeryxDB, WebSessionRecord } from "@/lib/db/keryx-db";
import { AccountError, type AccountMembershipStore } from "@/lib/accounts/contracts";

const selected = vi.hoisted(() => ({
  config: { baseUrl: "https://keryx.example/configured/base", networkId: "eip155:5042002",
    jwtSecret: "PUBLIC-SYNTHETIC-ACCOUNT267-ROUTE-TEST-SECRET" },
  getDb: vi.fn(), importDb: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ config: selected.config }));
vi.mock("@/lib/auth-session", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/auth-session")>();
  return { ...actual, parseWebSession: vi.fn(actual.parseWebSession) };
});
vi.mock("@/lib/accounts/request-adapter", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/accounts/request-adapter")>();
  return { ...actual, createOrdinaryAccountMembershipRoutes: vi.fn(actual.createOrdinaryAccountMembershipRoutes) };
});

const origin = "https://keryx.example", network = "eip155:5042002", url = `${origin}/api/account/membership`;
const baseConfig = { ...selected.config };
const wallet = `0x${"a".repeat(40)}`, otherWallet = `0x${"b".repeat(40)}`;
const consent = { version: 1, privateAccount: true, shareOwnedHistory: true };
type Facade = Pick<KeryxDB, "accountMembership" | "getWebSession" | "createWebSession" | "init">;
let facade: Facade, store: AccountMembershipStore, rows: Map<string, WebSessionRecord>;
let routes: typeof import("./route"), auth: typeof import("@/lib/auth-session"), realAuth: typeof auth;
let factory: typeof import("@/lib/accounts/request-adapter");

function request(token?: string, options: RequestInit = {}, requestUrl = url) {
  const headers = new Headers(options.headers);
  if (token) headers.set("cookie", `keryx_session=${token}`);
  return new Request(requestUrl, { ...options, headers });
}
function post(token: string, input: unknown, overrides: Record<string, string> = {}) {
  return request(token, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json",
    "X-Keryx-Expected-Wallet": wallet, ...overrides }, body: JSON.stringify(input) });
}
async function login(address = wallet, role: "asker" | "creator" | "dev" = "asker") {
  // Only this synthetic row map implements the issuer's durable-write fixture.
  const issued = await auth.issueWebSession(facade as KeryxDB, baseConfig.jwtSecret, address, role);
  const row = [...rows.values()].at(-1)!;
  vi.mocked(facade.createWebSession).mockClear();
  return { token: issued.token, row };
}
function privateResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}
function noMutation() {
  for (const method of [store.resume, store.issue, store.take, store.complete, store.unlink, store.revokeSession, store.assertCurrent])
    expect(method).not.toHaveBeenCalled();
  expect(facade.createWebSession).not.toHaveBeenCalled();
  expect(facade.init).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
}
function noDb() {
  expect(selected.importDb).not.toHaveBeenCalled();
  expect(selected.getDb).not.toHaveBeenCalled();
  expect(factory.createOrdinaryAccountMembershipRoutes).not.toHaveBeenCalled();
  expect(facade.getWebSession).not.toHaveBeenCalled();
  expect(store.resolve).not.toHaveBeenCalled(); expect(store.offer).not.toHaveBeenCalled();
  noMutation();
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); Object.assign(selected.config, baseConfig);
  selected.importDb.mockReset(); selected.getDb.mockReset();
  // resetModules retains manual mock caches; register a fresh lazy DB mock so
  // every module-await race is exercised without importing the real initializer.
  vi.doMock("@/lib/db", () => { selected.importDb(); return { getDb: selected.getDb }; });
  rows = new Map();
  const refuse = async () => { throw new AccountError("account_unavailable"); };
  store = { offer: vi.fn(async () => null), resolve: vi.fn(async () => null),
    resume: vi.fn(refuse), issue: vi.fn(refuse), take: vi.fn(refuse), complete: vi.fn(refuse),
    unlink: vi.fn(refuse), revokeSession: vi.fn(refuse), assertCurrent: vi.fn(refuse) };
  facade = { getWebSession: vi.fn(async (hash: string) => rows.get(hash) ?? null),
    createWebSession: vi.fn(async (row: WebSessionRecord) => { rows.set(row.hash, { ...row }); }),
    init: vi.fn(refuse) };
  Object.defineProperty(facade, "accountMembership", { get: () => store });
  // Any attempted raw/provenance/provider probing would fail this fixture.
  for (const name of ["db", "backend", "provider", "historyMembership", "signBrowserSigningOriginal", "reserveOnramp"])
    Object.defineProperty(facade, name, { get: () => { throw new Error(`Unexpected facade probe: ${name}`); } });
  selected.getDb.mockResolvedValue(facade);
  auth = await import("@/lib/auth-session");
  realAuth = await vi.importActual<typeof auth>("@/lib/auth-session");
  factory = await import("@/lib/accounts/request-adapter");
  routes = await import("./route");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider or spending IO in route fixtures"));
});
afterEach(() => { vi.restoreAllMocks(); });

describe("actual account route initialization boundary", () => {
  it("refuses missing cookie, wallet/header selectors and every bearer presence before importing/resolving DB", async () => {
    const l = await login();
    for (const incoming of [request(), request(undefined, { headers: { "X-Wallet": wallet,
      "X-Session-Hash": l.row.hash, "X-Account-Id": `acct_${"c".repeat(64)}`, "X-Provider": "circle" } }),
      ...["", "Bearer synthetic", `Bearer ${l.token}`].map(Authorization => request(l.token, { headers: { Authorization } })),
      post("", { action: "prepare-create", consent })])
      privateResponse(await (incoming.method === "POST" ? routes.POST(incoming) : routes.GET(incoming)), 401);
    noDb();
  });

  it("qualifies fixed origin, exact path, query/hash, handler method, POST Origin and initial abort before DB", async () => {
    const l = await login();
    for (const requestUrl of ["https://foreign.example/api/account/membership", `${origin}/api/account/other`, `${url}?backend=sqlite`, `${url}#account`])
      privateResponse(await routes.GET(request(l.token, { headers: { Host: "keryx.example", "X-Forwarded-Host": "keryx.example" } }, requestUrl)), 400);
    privateResponse(await routes.GET(request(l.token, { headers: { Origin: "https://foreign.example" } })), 403);
    privateResponse(await routes.POST(request(l.token, { method: "POST" })), 403);
    privateResponse(await routes.POST(post(l.token, {}, { Origin: "https://foreign.example" })), 403);
    for (const method of ["PUT", "POST"]) {
      const response = await routes.GET(request(l.token, { method }));
      privateResponse(response, 405); expect(response.headers.get("allow")).toBe("GET, POST");
    }
    privateResponse(await routes.POST(request(l.token)), 405);
    const abort = new AbortController(); abort.abort();
    privateResponse(await routes.GET(request(l.token, { signal: abort.signal })), 400);
    noDb();
  });

  it("refuses duplicate, ambiguous, malformed and oversized cookies before DB", async () => {
    const l = await login();
    for (const Cookie of [`keryx_session=${l.token}; keryx_session=${l.token}`, `keryx_session; keryx_session=${l.token}`,
      "keryx_session=", "keryx_session=bad", `keryx_session=${"a".repeat(4097)}.b.c`, `x=${"x".repeat(16_384)}; keryx_session=${l.token}`])
      privateResponse(await routes.GET(request(undefined, { headers: { Cookie } })), 401);
    noDb();
  });

  it("refuses forged signature, expired/future original times and a signed zero wallet before DB", async () => {
    const l = await login(), parts = l.token.split(".");
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    privateResponse(await routes.GET(request(parts.join("."))), 401);
    const now = Date.now();
    for (const issuedAt of [now - 8 * 86_400_000, now + 60_000]) {
      const clock = vi.spyOn(Date, "now").mockReturnValue(issuedAt);
      let timed: Awaited<ReturnType<typeof login>>;
      try { timed = await login(); } finally { clock.mockRestore(); }
      privateResponse(await routes.GET(request(timed.token)), 401);
    }
    const zero = await login(`0x${"0".repeat(40)}`);
    privateResponse(await routes.GET(request(zero.token)), 401);
    noDb();
  });

  it.each(["expiry", "abort"])("rechecks %s after genuine awaited JWT verification before DB", async race => {
    const l = await login(), abort = new AbortController();
    vi.mocked(auth.parseWebSession).mockImplementationOnce(async (token, secret) => {
      const claims = await realAuth.parseWebSession(token, secret);
      if (race === "expiry") vi.spyOn(Date, "now").mockReturnValue(l.row.expiresAt);
      else abort.abort();
      return claims;
    });
    privateResponse(await routes.GET(request(l.token, { signal: abort.signal })), race === "expiry" ? 401 : 400);
    noDb();
  });

  it.each(["expiry", "abort"])("rechecks %s after the DB module await before calling its resolver", async race => {
    const l = await login(), abort = new AbortController();
    selected.importDb.mockImplementationOnce(() => {
      if (race === "expiry") vi.spyOn(Date, "now").mockReturnValue(l.row.expiresAt);
      else abort.abort();
    });
    privateResponse(await routes.GET(request(l.token, { signal: abort.signal })), race === "expiry" ? 401 : 400);
    expect(selected.importDb).toHaveBeenCalledTimes(1); expect(selected.getDb).not.toHaveBeenCalled();
    expect(factory.createOrdinaryAccountMembershipRoutes).not.toHaveBeenCalled();
    expect(facade.getWebSession).not.toHaveBeenCalled(); noMutation();
  });

  it.each(["expiry", "abort"])("withholds capability and data reads on %s during the selected-facade await", async race => {
    const l = await login(), abort = new AbortController();
    selected.getDb.mockImplementationOnce(async () => {
      if (race === "expiry") vi.spyOn(Date, "now").mockReturnValue(l.row.expiresAt);
      else abort.abort();
      return facade;
    });
    privateResponse(await routes.GET(request(l.token, { signal: abort.signal })), race === "expiry" ? 401 : 400);
    expect(selected.getDb).toHaveBeenCalledExactlyOnceWith();
    expect(factory.createOrdinaryAccountMembershipRoutes).not.toHaveBeenCalled();
    expect(facade.getWebSession).not.toHaveBeenCalled(); noMutation();
  });

  it("supplies exactly the selected facade and captured config to the genuine factory without request labels or privileges", async () => {
    const l = await login(`0x${"A".repeat(40)}`, "creator"), before = [...rows.values()];
    const response = await routes.GET(request(l.token, { headers: { "X-Provider": "foreign", "X-Backend": "supabase",
      "X-Network": "eip155:5042", "X-Wallet": otherWallet, "X-Account-Id": `acct_${"c".repeat(64)}` } }));
    privateResponse(response, 200);
    expect(factory.createOrdinaryAccountMembershipRoutes).toHaveBeenCalledTimes(1);
    const capturedArguments = vi.mocked(factory.createOrdinaryAccountMembershipRoutes).mock.calls[0]!;
    expect(capturedArguments.length).toBe(1);
    const captured = capturedArguments[0]!;
    // Compare the selected facade by identity without asking Chai to inspect its
    // deliberately throwing raw/provider getters. Those tripwires stay intact.
    expect(captured.db === facade).toBe(true);
    expect(Object.keys(captured).sort()).toEqual(["db", "jwtSecret", "network", "origin"]);
    expect({ origin: captured.origin, network: captured.network, jwtSecret: captured.jwtSecret })
      .toEqual({ origin, network, jwtSecret: baseConfig.jwtSecret });
    expect(selected.getDb).toHaveBeenCalledExactlyOnceWith();
    expect(facade.getWebSession).toHaveBeenCalledExactlyOnceWith(l.row.hash);
    const value = await response.json();
    expect(value).toEqual({ version: 1, wallet, membership: null, offer: null });
    expect(JSON.stringify(value)).not.toContain(l.token); expect(JSON.stringify(value)).not.toContain(l.row.hash);
    expect(store.resolve).toHaveBeenCalledTimes(2); expect(store.offer).toHaveBeenCalledTimes(2);
    expect([...rows.values()]).toEqual(before); noMutation();
  });

  it("keeps missing/unqualified selected ports and resolver failures private 503 without durable reads or fallback", async () => {
    const l = await login(), read = vi.fn(async () => l.row);
    const omitted = { getWebSession: read }, unavailable = { getWebSession: read };
    Object.defineProperty(unavailable, "accountMembership", { get: () => undefined });
    for (const db of [omitted, unavailable, { getWebSession: read, accountMembership: store }]) {
      selected.getDb.mockResolvedValueOnce(db);
      privateResponse(await routes.GET(request(l.token)), 503);
      expect(factory.createOrdinaryAccountMembershipRoutes).toHaveBeenLastCalledWith({ db, origin, network, jwtSecret: baseConfig.jwtSecret });
    }
    selected.getDb.mockRejectedValueOnce(new Error("Selected storage unavailable"));
    privateResponse(await routes.GET(request(l.token)), 503);
    expect(selected.getDb).toHaveBeenCalledTimes(4); expect(read).not.toHaveBeenCalled();
    expect(facade.getWebSession).not.toHaveBeenCalled(); noMutation();
  });

  it("preserves genuine durable equality and expiry/abort checks rather than trusting the route preflight", async () => {
    const l = await login();
    vi.mocked(facade.getWebSession).mockResolvedValueOnce({ ...l.row, wallet: otherWallet });
    privateResponse(await routes.GET(request(l.token)), 401);
    const abort = new AbortController();
    vi.mocked(facade.getWebSession).mockImplementationOnce(async () => { abort.abort(); return l.row; });
    privateResponse(await routes.GET(request(l.token, { signal: abort.signal })), 400);
    vi.mocked(facade.getWebSession).mockImplementationOnce(async () => {
      vi.spyOn(Date, "now").mockReturnValue(l.row.expiresAt); return l.row;
    });
    privateResponse(await routes.GET(request(l.token)), 401);
    expect(store.resolve).not.toHaveBeenCalled(); expect(store.offer).not.toHaveBeenCalled(); noMutation();
  });

  it("passes POST through the existing bounded consent and expected-wallet refusals without mutation", async () => {
    const l = await login(), missing = post(l.token, { action: "prepare-create", consent });
    missing.headers.delete("x-keryx-expected-wallet");
    privateResponse(await routes.POST(missing), 428);
    privateResponse(await routes.POST(post(l.token, { action: "prepare-create", consent }, { "X-Keryx-Expected-Wallet": otherWallet })), 409);
    privateResponse(await routes.POST(post(l.token, { action: "prepare-create", consent: { ...consent, shareOwnedHistory: false } })), 400);
    privateResponse(await routes.POST(post(l.token, { action: "prepare-create", consent, provider: "circle" })), 400);
    privateResponse(await routes.POST(post(l.token, { action: "prepare-create", consent }, { "Content-Type": "text/plain" })), 400);
    noMutation();
  });

  it("refuses invalid fixed origin/network/secret configuration before DB without inspecting ENV", async () => {
    const l = await login();
    for (const override of [{ baseUrl: "invalid" }, { baseUrl: "http://foreign.example" }, { networkId: "eip155:1" },
      { jwtSecret: "" }, { jwtSecret: "short" }]) {
      Object.assign(selected.config, baseConfig, override); vi.resetModules();
      const configured = await import("./route");
      privateResponse(await configured.GET(request(l.token)), 503);
    }
    expect(selected.importDb).not.toHaveBeenCalled(); expect(selected.getDb).not.toHaveBeenCalled();
    expect(facade.getWebSession).not.toHaveBeenCalled(); noMutation();
  });
});
