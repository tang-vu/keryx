import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { KeryxDB } from "../db/keryx-db";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqliteRunClaims, RUN_CLAIMS_SQL } from "../db/run-claims-sqlite";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { createSqliteRunOwnershipHistory } from "../db/run-ownership-history-sqlite";
import type { QueryRun } from "../types";
import { createRunClaimRoutes } from "./http";
import { runClaimTokenHash } from "./service";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, token = "c".repeat(64), sessionHash = "d".repeat(64);
const binding = { network: "eip155:5042002" as const, origin: "https://synthetic-claims.example" };
const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
async function fixture() {
  const sql = new DatabaseSync(":memory:"); opened.push(sql); installSqliteApplicationSchema(sql); sql.exec(RUN_CLAIMS_SQL);
  let stamp = Date.now();
  const run: QueryRun = { id: "unowned-run", question: "Synthetic claim", answer: "Private saved answer", createdAt: new Date(stamp).toISOString(),
    budget: 0, engine: "heuristic", subClaims: [], decisions: [], citations: [], trace: [], totalSpent: 0, totalToCreators: 0, paymentMode: "offline" };
  writeSqliteQueryRun(sql, run, false);
  sql.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)").run(sessionHash, alice, stamp - 1000, stamp + 172800000);
  const claims = createSqliteRunClaims(sql, { fixtureClock: () => stamp });
  await claims.issue({ runId: run.id, completedAt: run.createdAt, tokenHash: runClaimTokenHash(token, binding), binding });
  const order: string[] = [];
  // Keep the real transactional implementation; spy observes the hash-only boundary.
  const original = claims.claim.bind(claims);
  const observed = vi.fn(async (input: Parameters<typeof claims.claim>[0]) => { order.push("claim"); return original(input); });
  const consumeRateLimit = vi.fn(async (_key: string, _limit: number, _window: number, _now: number) => { order.push("rate"); return { allowed: true, msBeforeNext: 60000 }; });
  const db = { runClaims: { ...claims, claim: observed }, runOwnershipHistory: createSqliteRunOwnershipHistory(sql), consumeRateLimit } as unknown as KeryxDB;
  const session = vi.fn(async () => ({ db, wallet: alice, currentId: sessionHash } as { db: KeryxDB; wallet: string; currentId: string } | Response));
  const key = vi.fn(async () => ({ walletAddress: bob, scopes: "history:read" } as { walletAddress: string; scopes: string | null } | null));
  const deps = { enabled: true, binding, session, key, db: async () => db, now: () => stamp };
  const routes = createRunClaimRoutes(deps);
  const request = (body: unknown = { token }, headers: Record<string, string> = {}, url = "/api/me/run-claims") => new Request(binding.origin + url, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: binding.origin, "X-Keryx-Expected-Wallet": alice,
      "cf-connecting-ip": "192.0.2.5", ...headers }, body: JSON.stringify(body) });
  return { sql, run, db, deps, routes, request, observed, consumeRateLimit, order, setNow: (next: number) => { stamp = next; } };
}
describe("private claim HTTP authority", () => {
  it("limits before hash-only lookup, attaches ownership without changing the saved original, and never caches", async () => {
    const f = await fixture(), before = f.sql.prepare("SELECT data FROM query_runs").get();
    const response = await f.routes.POST(f.request());
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ wallet: alice, runId: f.run.id });
    expect(f.order).toEqual(["rate", "rate", "claim"]);
    expect(f.observed.mock.calls[0][0]).toMatchObject({ tokenHash: runClaimTokenHash(token, binding), wallet: alice, sessionHash });
    expect(JSON.stringify(f.observed.mock.calls)).not.toContain(token);
    const keys = f.consumeRateLimit.mock.calls as unknown as [string][];
    expect(keys[0][0]).toBe(`run-claim-wallet:${alice}`); expect(keys[1][0]).toMatch(/^run-claim-ip:[a-f0-9]{64}$/);
    expect(keys[1][0]).not.toContain("192.0.2.5"); expect(f.sql.prepare("SELECT data FROM query_runs").get()).toEqual(before);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it.each(["unknown", "expired", "used", "owned", "changed", "missing", "malformed", "extra"])("%s has the same refusal without token echo", async reason => {
    const f = await fixture(); let body: unknown = { token };
    if (reason === "unknown") body = { token: "e".repeat(64) };
    if (reason === "expired") f.setNow(Date.now() + 86400001);
    if (reason === "used") await f.routes.POST(f.request());
    if (reason === "owned") f.sql.prepare("UPDATE query_runs SET asker=?").run(bob);
    if (reason === "changed") f.sql.prepare("UPDATE query_runs SET data=json_set(data,'$.answer','Changed')").run();
    if (reason === "missing") body = {};
    if (reason === "malformed") body = { token: "bad" };
    if (reason === "extra") body = { token, wallet: bob };
    const response = await f.routes.POST(f.request(body)); expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "claim_unavailable" });
  });
  it("rechecks a session revoked between HTTP authentication and the actual SQLite transaction", async () => {
    const f = await fixture(); f.deps.session.mockImplementation(async () => {
      f.sql.prepare("DELETE FROM web_sessions WHERE hash=?").run(sessionHash);
      return { db: f.db, wallet: alice, currentId: sessionHash };
    });
    const response = await f.routes.POST(f.request()); expect(response.status).toBe(401);
    expect(f.sql.prepare("SELECT claimed_wallet FROM anonymous_run_claims").get()).toEqual({ claimed_wallet: null });
  });
  it.each<Record<string, string>>([{ Origin: "https://evil.example" }, { Origin: "http://synthetic-claims.example" }, { Origin: "" }, { "sec-fetch-site": "cross-site" }])("refuses CSRF before counters or lookup: %j", async headers => {
    const f = await fixture(); expect((await f.routes.POST(f.request(undefined, headers))).status).toBe(403);
    expect(f.consumeRateLimit).not.toHaveBeenCalled(); expect(f.observed).not.toHaveBeenCalled();
  });
  it("uses configured origin despite an internal request URL and refuses changed owner/body authority", async () => {
    const f = await fixture(); const request = f.request();
    expect((await f.routes.POST(new Request("http://internal.invalid/api/me/run-claims", { method: "POST", headers: request.headers, body: JSON.stringify({ token }) }))).status).toBe(200);
    const g = await fixture(); expect((await g.routes.POST(g.request(undefined, { "X-Keryx-Expected-Wallet": bob }))).status).toBe(409);
    expect(g.observed).not.toHaveBeenCalled();
  });
  it("requires an interactive wallet session plus an owner precondition, never API-key claim authority", async () => {
    const f = await fixture(), request = f.request(); request.headers.delete("X-Keryx-Expected-Wallet");
    expect((await f.routes.POST(request)).status).toBe(428);
    expect((await f.routes.POST(f.request(undefined, { Authorization: `Bearer kx_live_${"a".repeat(96)}` }))).status).toBe(403);
    f.deps.session.mockResolvedValue(Response.json({ error: "unauthenticated" }, { status: 401 }));
    expect((await f.routes.POST(f.request())).status).toBe(401); expect(f.observed).not.toHaveBeenCalled(); expect(f.deps.key).not.toHaveBeenCalled();
  });
  it.each(["throttled", "outage"])("%s refuses before parsing/looking up the token with no memory fallback", async kind => {
    const f = await fixture();
    if (kind === "throttled") f.consumeRateLimit.mockResolvedValue({ allowed: false, msBeforeNext: 60000 });
    else f.consumeRateLimit.mockRejectedValue(new Error("Synthetic durable outage"));
    const response = await f.routes.POST(f.request()); expect(response.status).toBe(kind === "throttled" ? 429 : 503);
    expect(f.observed).not.toHaveBeenCalled(); expect(await response.text()).not.toContain(token);
  });
  it("bounds chunked input before parsing and refuses URL/query token delivery", async () => {
    const f = await fixture(), request = f.request("x".repeat(512)); request.headers.delete("content-length");
    expect((await f.routes.POST(request)).status).toBe(404); expect(f.observed).not.toHaveBeenCalled();
    expect((await f.routes.POST(f.request(undefined, {}, `/?token=${token}`))).status).toBe(404); expect(f.observed).not.toHaveBeenCalled();
  });
  it("default-off and sealed absence refuse without auth, fallback or schema repair", async () => {
    const f = await fixture(); const off = createRunClaimRoutes({ ...f.deps, enabled: false });
    expect((await off.POST(f.request())).status).toBe(503); expect(f.deps.session).not.toHaveBeenCalled();
    Object.defineProperty(f.db, "runClaims", { get() { throw new Error("Sealed"); } });
    expect((await f.routes.POST(f.request())).status).toBe(503);
    expect(f.sql.prepare("SELECT count(*) AS n FROM anonymous_run_claims").get()).toEqual({ n: 1 });
  });
});
describe("gated ownership history HTTP", () => {
  it("returns private summary and unchanged original with ownership separately, never raw claim credentials", async () => {
    const f = await fixture(); await f.routes.POST(f.request());
    const list = await f.routes.LIST(new Request(`${binding.origin}/api/me/run-history`));
    const value = await list.json(); expect(value.rows).toHaveLength(1); expect(value.rows[0].ownership.method).toBe("claimed");
    expect(JSON.stringify(value)).not.toMatch(/Private saved answer|tokenHash|token_hash|sessionHash/);
    const detail = await f.routes.DETAIL(new Request(`${binding.origin}/api/me/run-history/${f.run.id}`), f.run.id);
    const item = await detail.json(); expect(item.run).toEqual(f.run); expect(item.run).not.toHaveProperty("asker");
    expect(item.ownership.method).toBe("claimed"); expect(item.wallet).toBe(alice);
    for (const response of [list, detail]) { expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow"); }
  });
  it("API keys require explicit history read, cannot fall back to cookie or select another owner", async () => {
    const f = await fixture(), headers = { Authorization: `Bearer kx_live_${"a".repeat(96)}` };
    await f.routes.POST(f.request()); f.deps.session.mockClear();
    const request = new Request(`${binding.origin}/api/me/run-history`, { headers });
    expect((await f.routes.LIST(request)).status).toBe(200); expect(f.deps.session).not.toHaveBeenCalled();
    expect((await f.routes.DETAIL(request, f.run.id)).status).toBe(404);
    f.deps.key.mockResolvedValue({ walletAddress: bob, scopes: "profile:read" }); expect((await f.routes.LIST(request)).status).toBe(403);
    f.deps.key.mockResolvedValue(null); expect((await f.routes.LIST(request)).status).toBe(401);
  });
  it("rejects selectors/native IDs and changed originals without exposing another owner", async () => {
    const f = await fixture(); await f.routes.POST(f.request());
    expect((await f.routes.LIST(new Request(`${binding.origin}/?wallet=${bob}`))).status).toBe(400);
    expect((await f.routes.DETAIL(new Request(binding.origin), "a2a_original")).status).toBe(400);
    f.sql.prepare("UPDATE query_runs SET data=json_set(data,'$.answer','changed')").run();
    expect((await f.routes.DETAIL(new Request(binding.origin), f.run.id)).status).toBe(404);
    expect((await (await f.routes.LIST(new Request(binding.origin))).json()).rows).toEqual([]);
  });
});
