import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import type { KeryxDB } from "../db/keryx-db";
import { webSessionHash } from "../auth-session";
import { topicWatchOpenApiPaths } from "./topic-watches-openapi";
import { createTopicWatchManagement, type TopicWatchAccountContext } from "./topic-watch-service";

const base = "https://watch-contract.invalid", wallet = `0x${"a".repeat(40)}`, sessionId = "c".repeat(64);
const spec = () => ({ watchId: "contract-watch", question: "Transformer metadata", keywords: ["transformer"],
  cadenceMs: 60_000, periodMs: 60_000, maximumChecksPerPeriod: 1, maximumRowsPerCheck: 1,
  maximumDigestItems: 1, expiresAtMs: Date.now() + 60_000,
  requestedCaps: { perCheckMicroUsdc: 0, perPeriodMicroUsdc: 0 }, consent: { manualMetadata: true, emptyHeartbeat: false } });
function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${base}/api/me/topic-watches`, { method, headers: { origin: base,
    "x-keryx-expected-wallet": wallet, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
/** Synthetic web-session/store boundary only. No native DB, provider or financial proof. */
function boundary() {
  const read = vi.fn(async (): Promise<unknown | null> => null), write = vi.fn(async () => false);
  const list = vi.fn(async () => []);
  const db = { getWebSession: vi.fn(async () => ({ hash: sessionId, wallet,
    issuedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000 })),
    topicWatches: { bindSession: vi.fn(() => ({ read, compareAndSwap: write, list })) } } as unknown as KeryxDB;
  let context: TopicWatchAccountContext | Response = { db, wallet, currentId: sessionId };
  const session = vi.fn(async () => context);
  return { routes: createTopicWatchManagement(session, base), session, db, read, write, list,
    replace: () => { context = { db, wallet, currentId: "d".repeat(64) }; } };
}
const collection = topicWatchOpenApiPaths["/api/me/topic-watches"];
const item = topicWatchOpenApiPaths["/api/me/topic-watches/{id}"];
describe("topic watch supported contract (authored UNRUN)", () => {
  it("matches actual explicit route exports and aggregate additive wiring", () => {
    const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const exports = (text: string) => [...text.matchAll(/export (?:async function|const) (GET|POST|PUT|DELETE|PATCH)\b/g)]
      .map(match => match[1].toLowerCase()).sort();
    expect(Object.keys(collection).sort()).toEqual(exports(source("../../app/api/me/topic-watches/route.ts")));
    expect(Object.keys(item).sort()).toEqual(exports(source("../../app/api/me/topic-watches/[id]/route.ts")));
    const aggregate = source("../openapi-spec.ts");
    expect(aggregate.match(/\.\.\.topicWatchOpenApiPaths/g)).toHaveLength(1);
    expect(aggregate).toContain('import { topicWatchOpenApiPaths } from "./research/topic-watches-openapi";');
  });
  it("declares only cookie-session authority and actual owner/revision/body boundaries", () => {
    for (const operation of [...Object.values(collection), ...Object.values(item)]) {
      expect(operation.security).toEqual([{ WebSession: [] }]);
      expect(operation.parameters.find(parameter => parameter.name === "X-Keryx-Expected-Wallet")?.required).toBe(true);
      expect(operation.parameters.some(parameter => parameter.in === "query")).toBe(false);
    }
    for (const operation of [item.put, item.post, item.delete])
      expect(operation.parameters.find(parameter => parameter.name === "If-Match")?.required).toBe(true);
    expect(item.delete).not.toHaveProperty("requestBody");
    const schema = collection.post.requestBody.content["application/json"].schema as { additionalProperties: unknown; properties: unknown };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).not.toHaveProperty("ownerWallet");
    expect(schema.properties).not.toHaveProperty("sessionId");
    expect(Object.keys(collection.post.responses).sort()).toEqual(["201", "400", "401", "403", "409", "422", "428", "503"]);
  });
});
describe("factory failure controls: synthetic session boundary, UNRUN; not native/payment acceptance", () => {
  it.each(['W/"1"', '"0"', '"9007199254740992"', '1', '*', '"1", "2"'])("refuses If-Match %s before body parsing or write", async match => {
    const f = boundary();
    const response = await f.routes.action(request("POST", { action: "pause" }, { "if-match": match }), "contract-watch");
    expect(response.status).toBe(428); expect(await response.json()).toEqual({ error: "revision_precondition_required" });
    expect(f.read).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["cross-site", "same-site", "none"])("refuses Sec-Fetch-Site %s before session resolution", async site => {
    const f = boundary();
    const response = await f.routes.create(request("POST", spec(), { "sec-fetch-site": site }));
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "same_origin_required" });
    expect(f.session).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["token=synthetic", "wallet=synthetic", "key=synthetic"])("refuses query authority %s before session", async query => {
    const f = boundary(); const response = await f.routes.list(new Request(`${base}/api/me/topic-watches?${query}`));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_watch" });
    expect(f.session).not.toHaveBeenCalled();
  });
  it("preserves provided-context refusal even when expected owner is present", async () => {
    const session = vi.fn(async () => Response.json({ error: "Sign in to access your account." }, { status: 401 }));
    const routes = createTopicWatchManagement(session, base);
    const response = await routes.list(request("GET"));
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "Sign in to access your account." });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const bearer = await routes.list(request("GET", undefined, { authorization: "Bearer synthetic" }));
    expect(bearer.status).toBe(401); expect(await bearer.json()).toEqual({ error: "session_required" });
    expect(session).toHaveBeenCalledTimes(1);
  });
  it("suppresses a late private list after same-wallet session replacement", async () => {
    const f = boundary(); let finish!: (value: never[]) => void, enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    f.list.mockImplementationOnce(() => { enter(); return new Promise(resolve => { finish = resolve; }); });
    const pending = f.routes.list(request("GET")); await entered; f.replace(); finish([]);
    const response = await pending; expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "watch_unavailable" }); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["invalid-wallet", `0x${"b".repeat(40)}`])("never selects storage using expected wallet %s", async expected => {
    const f = boundary(); const response = await f.routes.list(request("GET", undefined, { "x-keryx-expected-wallet": expected }));
    expect(response.status).toBe(expected === "invalid-wallet" ? 400 : 409);
    expect(f.db.topicWatches!.bindSession).not.toHaveBeenCalled();
  });
  it("valid create with failed CAS returns conflict rather than created authority", async () => {
    const f = boundary(); const response = await f.routes.create(request("POST", spec()));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ result: { status: "conflict", paidRequests: 0, standingSpend: "withheld" } });
    expect(f.write).toHaveBeenCalledTimes(1);
  });
  it("maps invalid expiry to semantic refusal without CAS", async () => {
    const f = boundary(); const response = await f.routes.create(request("POST", { ...spec(), expiresAtMs: 0 }));
    expect(response.status).toBe(422); expect(await response.json()).toEqual({ result: { status: "refused", code: "invalid-expiry", paidRequests: 0, standingSpend: "withheld" } });
    expect(f.write).not.toHaveBeenCalled();
  });
});

describe("actual route cookie boundary: real JWT/session checks, synthetic infrastructure, UNRUN", () => {
  // Only request-cookie delivery, selected DB and fixed test config are synthetic.
  // No parser, accountSessionContext or session authorization is mocked.
  const secret = "synthetic-watch-contract-secret", jti = "e".repeat(64);
  const hash = webSessionHash(jti);
  let token: string | undefined, validToken: string, issuedAt: number, expiresAt: number;
  let row: Awaited<ReturnType<KeryxDB["getWebSession"]>>;
  let db: KeryxDB;
  const cookies = vi.fn(), selectedDb = vi.fn(), lookup = vi.fn();
  const read = vi.fn(), write = vi.fn(), list = vi.fn(), bindSession = vi.fn();
  let collectionRoute: typeof import("../../app/api/me/topic-watches/route");
  let itemRoute: typeof import("../../app/api/me/topic-watches/[id]/route");
  const sign = (signingSecret = secret, expiration = expiresAt) => new SignJWT({ address: wallet, role: "asker" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer("keryx-web").setAudience("keryx-account")
    .setJti(jti).setIssuedAt(issuedAt / 1000).setExpirationTime(expiration / 1000)
    .sign(new TextEncoder().encode(signingSecret));

  beforeEach(async () => {
    vi.resetModules();
    for (const mock of [cookies, selectedDb, lookup, read, write, list, bindSession]) mock.mockReset();
    issuedAt = Math.floor(Date.now() / 1000) * 1000 - 2000;
    expiresAt = issuedAt + 60_000;
    row = { hash, wallet, issuedAt, expiresAt };
    lookup.mockImplementation(async () => row);
    read.mockResolvedValue(null); write.mockResolvedValue(false); list.mockResolvedValue([]);
    bindSession.mockReturnValue({ read, compareAndSwap: write, list });
    db = { getWebSession: lookup, topicWatches: { bindSession } } as unknown as KeryxDB;
    cookies.mockImplementation(async () => ({ get: (name: string) => name === "keryx_session" && token ? { value: token } : undefined }));
    selectedDb.mockResolvedValue(db);
    vi.doMock("next/headers", () => ({ cookies }));
    vi.doMock("@/lib/db", () => ({ getDb: selectedDb }));
    vi.doMock("@/lib/config", () => ({ config: { jwtSecret: secret, baseUrl: base } }));
    validToken = await sign(); token = validToken;
    collectionRoute = await import("../../app/api/me/topic-watches/route");
    itemRoute = await import("../../app/api/me/topic-watches/[id]/route");
  });
  afterEach(() => {
    vi.doUnmock("next/headers"); vi.doUnmock("@/lib/db"); vi.doUnmock("@/lib/config");
    vi.resetModules();
    for (const mock of [cookies, selectedDb, lookup, read, write, list, bindSession]) mock.mockReset();
    token = undefined; row = null;
  });
  function privateHeaders(response: Response) {
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  }
  async function refused() {
    const response = await collectionRoute.GET(request("GET"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to access your account." });
    privateHeaders(response);
    expect(cookies).toHaveBeenCalled();
    expect(bindSession).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  }
  it.each(["missing", "invalid-signature", "expired-jwt"])("refuses %s before selected DB/private port IO", async mode => {
    token = mode === "missing" ? undefined : mode === "invalid-signature" ? await sign("wrong-synthetic-secret") : await sign(secret, issuedAt + 1000);
    if (mode === "expired-jwt") row = { hash, wallet, issuedAt, expiresAt: issuedAt + 1000 };
    await refused();
    expect(selectedDb).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled();
  });
  it.each(["revoked", "hash", "wallet", "issuedAt", "expiresAt", "expired-row"])("refuses exact durable-row %s before private port IO", async mode => {
    row = mode === "revoked" ? null : { hash, wallet, issuedAt, expiresAt,
      ...(mode === "hash" ? { hash: "f".repeat(64) } : {}),
      ...(mode === "wallet" ? { wallet: `0x${"b".repeat(40)}` } : {}),
      ...(mode === "issuedAt" ? { issuedAt: issuedAt - 1000 } : {}),
      ...(mode === "expiresAt" ? { expiresAt: expiresAt + 1000 } : {}),
      ...(mode === "expired-row" ? { expiresAt: issuedAt + 1000 } : {}) };
    await refused();
    expect(selectedDb).toHaveBeenCalledTimes(1); expect(lookup).toHaveBeenCalledExactlyOnceWith(hash);
  });
  it("authenticates proper cookie through actual collection and item route wiring", async () => {
    const response = await collectionRoute.GET(request("GET"));
    expect(response.status).toBe(200); privateHeaders(response);
    expect(await response.json()).toEqual({ watches: [], metadataSource: "local-curated-catalog", spendMicroUsdc: 0 });
    expect(bindSession).toHaveBeenCalledWith({ hash, wallet, issuedAt, expiresAt });
    expect(list).toHaveBeenCalledTimes(1);
    const itemResponse = await itemRoute.GET(request("GET"), { params: Promise.resolve({ id: "contract-watch" }) });
    expect(itemResponse.status).toBe(404); privateHeaders(itemResponse);
    expect(await itemResponse.json()).toEqual({ error: "watch_not_found" });
    expect(read).toHaveBeenCalledExactlyOnceWith({ ownerWallet: wallet, watchId: "contract-watch" });
    expect(write).not.toHaveBeenCalled();
  });
  it("rechecks real interactive cookie authority after awaited private IO", async () => {
    list.mockImplementationOnce(async () => { token = undefined; return []; });
    const response = await collectionRoute.GET(request("GET"));
    expect(response.status).toBe(503); privateHeaders(response);
    expect(await response.json()).toEqual({ error: "watch_unavailable" });
    expect(list).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled();
  });
});
