import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { issueWebSession, parseWebSession, webSessionHash } from "../auth-session";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn(), admit: vi.fn(), height: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/config", async importOriginal => {
  const actual = await importOriginal<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, jwtSecret: "synthetic-withdrawal-session" } };
});
vi.mock("./withdrawal-admission-bootstrap", () => ({ createWithdrawalRuntimeAdmission: () => mocks.admit }));
vi.mock("./withdrawal-height-window", () => ({ withdrawalHeightWindowForRpc: mocks.height }));
import { createWithdrawalHttpService } from "./withdrawal-http-service";
import { POST as prepareRoute } from "../../app/api/me/withdrawals/prepare/route";
import { POST as submitRoute } from "../../app/api/me/withdrawals/submit/route";
import { POST as statusRoute } from "../../app/api/me/withdrawals/status/route";

const directory = mkdtempSync(join(tmpdir(), "keryx-withdrawal-http-"));
const db = new SqliteAdapter(join(directory, "app.sqlite"));
const storage = new AsyncLocalStorage<{ token?: string }>(), secret = "synthetic-withdrawal-session";
beforeAll(async () => {
  await db.init(); mocks.db.mockResolvedValue(db);
  mocks.cookies.mockImplementation(async () => ({ get: () => ({ value: storage.getStore()?.token }) }));
}, 60000);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); mocks.admit.mockReset(); });
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const request = (kind: string, body: unknown) => new Request(`https://keryx.test/api/me/withdrawals/${kind}`, {
  method: "POST", headers: { host: "keryx.test", origin: "https://keryx.test", "content-type": "application/json" }, body: JSON.stringify(body) });
async function fixture() {
  const f = await creatorWithdrawalFixture({ maxBlockHeight: "11000" }), session = await issueWebSession(db, secret, f.record.owner, "creator");
  mocks.height.mockReset(); mocks.height.mockResolvedValue({ minimumBlockHeight: "10500", maximumBlockHeight: "12000" });
  const { owner: _owner, recipient: _recipient, ...limits } = f.record.policy; void _owner; void _recipient;
  const options = { env: {}, network: "eip155:5042002", rpcUrl: "https://rpc.synthetic.invalid", ceilingWei: "1", limits,
    heightLimits: { maxAheadBlocks: "2000", maxProcessingLagBlocks: "10" } };
  const service = createWithdrawalHttpService(options), state = { token: session.token };
  return { ...f, state, service, options, run: <T>(fn: () => T) => storage.run(state, fn),
    revoke: async () => db.revokeWebSession(webSessionHash((await parseWebSession(session.token, secret))!.jti), f.record.owner) };
}

it("keeps actual recovery routes authenticated when creation is disabled or malformed", async () => {
  const f = await fixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await db.reserveCreatorWithdrawal(f.record);
  vi.stubEnv("KERYX_WITHDRAWAL_HTTP_ENABLED", "0");
  vi.stubEnv("KERYX_WITHDRAWAL_RELAY_DIRECTORY", "");
  vi.stubEnv("KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY", "invalid-unused-key");
  for (const route of [prepareRoute, submitRoute]) {
    const response = await f.run(() => route(request("submit", f.record.request)));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
  }
  vi.stubEnv("KERYX_WITHDRAWAL_HTTP_ENABLED", "invalid");
  expect((await storage.run({}, () => statusRoute(request("status", { id: f.record.id })))).status).toBe(401);
  const response = await f.run(() => statusRoute(request("status", { id: f.record.id })));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ wallet: f.record.owner, status: "request-stored", mintStatus: "not-checked" });
  expect(response.headers.get("vary")).toBe("Cookie, Origin");
  const other = await fixture();
  expect((await other.run(() => statusRoute(request("status", { id: f.record.id })))).status).toBe(404);
  await f.revoke();
  expect((await f.run(() => statusRoute(request("status", { id: f.record.id })))).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled(); expect(mocks.admit).not.toHaveBeenCalled();
});

it("does not hide missing configured mint history behind a transfer-only success", async () => {
  const f = await fixture(); await db.reserveCreatorWithdrawal(f.record);
  vi.stubEnv("KERYX_WITHDRAWAL_HTTP_ENABLED", "0");
  vi.stubEnv("KERYX_WITHDRAWAL_RELAY_DIRECTORY", join(directory, "missing-relay"));
  const response = await f.run(() => statusRoute(request("status", { id: f.record.id })));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(directory);
});

it("binds enabled prepare and submit routes to server limits, sessions and one Circle attempt", async () => {
  const f = await fixture(), key = generatePrivateKey();
  const env = { KERYX_WITHDRAWAL_HTTP_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ISOLATED: "1",
    KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY: key, KERYX_WITHDRAWAL_RELAY_ADDRESS: privateKeyToAccount(key).address,
    KERYX_WITHDRAWAL_RELAY_DIRECTORY: directory, AGENT_FUNDER_PRIVATE_KEY: generatePrivateKey(), KERYX_FORCE_OFFLINE: "0",
    KERYX_WITHDRAWAL_MAX_VALUE_MICROS: "50000", KERYX_WITHDRAWAL_MAX_FEE_MICROS: f.record.policy.maxFeeMicros,
    KERYX_WITHDRAWAL_GAS_CEILING_WEI: "1", KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: "2000", KERYX_WITHDRAWAL_MAX_PROCESSING_LAG_BLOCKS: "10" };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const fetcher = vi.fn(async (url, init) => {
    if (String(url).endsWith("/estimate")) return Response.json([{ burnIntent: {
      spec: JSON.parse(init.body)[0].spec, maxBlockHeight: "11000", maxFee: "1" } }]);
    expect(JSON.parse(init.body)).toEqual([f.record.request]); return Response.json(f.response);
  }); vi.stubGlobal("fetch", fetcher);
  expect((await storage.run({}, () => prepareRoute(request("prepare", { amountMicros: "50000" })))).status).toBe(401);
  const prepared = await f.run(() => prepareRoute(request("prepare", { amountMicros: "50000" })));
  expect(prepared.status).toBe(200);
  expect((await prepared.json()).draft.owner).toBe(f.record.owner);
  expect((await f.run(() => submitRoute(request("submit", f.record.request)))).status).toBe(202);
  expect((await f.run(() => submitRoute(request("submit", f.record.request)))).status).toBe(202);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("uses real signed cookies and durable owner claims around the concrete Circle HTTP transport", async () => {
  const f = await fixture(), fetcher = vi.fn(async (url, init) => {
    expect(url).toBe("https://gateway-api-testnet.circle.com/v1/transfer");
    expect(JSON.parse(init.body)).toEqual([f.record.request]);
    expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).not.toBeNull();
    return Response.json(f.response);
  }); vi.stubGlobal("fetch", fetcher);
  expect((await storage.run({}, () => f.service.submit(request("submit", f.record.request)))).status).toBe(401);
  expect((await f.run(() => f.service.submit(request("submit", f.record.request)))).status).toBe(202);
  expect((await f.run(() => f.service.submit(request("submit", f.record.request)))).status).toBe(202);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const status = await f.run(() => f.service.status(request("status", { id: f.record.id })));
  const body = await status.json();
  expect(body).toMatchObject({ wallet: f.record.owner, status: "attestation-stored", chainFinalityVerified: false });
  expect(JSON.stringify(body)).not.toContain(f.state.token); expect(body.signature).toBeUndefined();
  await f.revoke();
  expect((await f.run(() => f.service.status(request("status", { id: f.record.id })))).status).toBe(401);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("denies a same-wallet replacement cookie during admission without acquiring a transfer claim", async () => {
  const f = await fixture(), replacement = await issueWebSession(db, secret, f.record.owner, "creator");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  mocks.admit.mockImplementationOnce(async () => { f.state.token = replacement.token; });
  expect((await f.run(() => f.service.submit(request("submit", f.record.request)))).status).toBe(503);
  expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it("retains the claim after real session revocation during claim storage and never resubmits it", async () => {
  const f = await fixture(), claim = db.claimCreatorWithdrawalTransfer.bind(db), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  vi.spyOn(db, "claimCreatorWithdrawalTransfer").mockImplementationOnce(async (...args) => {
    const result = await claim(...args); await f.revoke(); return result;
  });
  expect((await f.run(() => f.service.submit(request("submit", f.record.request)))).status).toBe(503);
  expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).not.toBeNull();
  f.state.token = (await issueWebSession(db, secret, f.record.owner, "creator")).token;
  const response = await f.run(() => f.service.submit(request("submit", f.record.request)));
  expect(await response.json()).toMatchObject({ status: "awaiting-transfer-evidence" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects other networks before constructing a submission service", async () => {
  const f = await fixture(); expect(() => createWithdrawalHttpService({ ...f.options, network: "eip155:1" })).toThrow();
});

it("prepares only unsigned owner-bound terms without reserving a request or spending the submit allowance", async () => {
  const f = await fixture();
  const fetcher = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith("/estimate")) {
      expect(Object.keys(body[0])).toEqual(["spec"]);
      return Response.json([{ burnIntent: { spec: body[0].spec, maxBlockHeight: "11000", maxFee: "1" } }]);
    }
    expect(String(url).endsWith("/transfer")).toBe(true); return Response.json(f.response);
  }); vi.stubGlobal("fetch", fetcher);
  for (let i = 0; i < 3; i++) {
    const response = await f.run(() => f.service.prepare(request("prepare", { amountMicros: "50000" })));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.draft).toMatchObject({ owner: f.record.owner, policy: { recipient: f.record.owner },
      burnIntent: { maxBlockHeight: "11000", maxFee: "1", spec: { value: "50000" } } });
    expect(body.draft.request).toBeUndefined();
    expect(await db.getCreatorWithdrawal(body.draft.id, f.record.owner)).toBeNull();
  }
  expect((await f.run(() => f.service.prepare(request("prepare", { amountMicros: "50000" })))).status).toBe(429);
  expect(mocks.admit).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3);
  expect((await f.run(() => f.service.submit(request("submit", f.record.request)))).status).toBe(202);
});

it("rejects extra preparation fields and withholds estimates after session revocation", async () => {
  const f = await fixture();
  const fetcher = vi.fn(async (_url, init) => {
    await f.revoke();
    return Response.json([{ burnIntent: { spec: JSON.parse(init.body)[0].spec, maxBlockHeight: "11000", maxFee: "1" } }]);
  }); vi.stubGlobal("fetch", fetcher);
  expect((await f.run(() => f.service.prepare(request("prepare", { amountMicros: "50000", recipient: f.record.owner })))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const denied = await f.run(() => f.service.prepare(request("prepare", { amountMicros: "50000" })));
  expect(denied.status).toBe(503); expect(await denied.text()).not.toContain(f.record.owner);
  expect(mocks.admit).not.toHaveBeenCalled();
});

it("rejects stale expiry before gas admission and retains a claim when expiry advances before transfer", async () => {
  const early = await fixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  mocks.height.mockResolvedValue({ minimumBlockHeight: "11001", maximumBlockHeight: "12000" });
  expect((await early.run(() => early.service.submit(request("submit", early.record.request)))).status).toBe(503);
  expect(mocks.admit).not.toHaveBeenCalled();
  expect(await db.getCreatorWithdrawalTransferClaim(early.record.id, early.record.owner)).toBeNull();
  const late = await fixture();
  mocks.height.mockResolvedValueOnce({ minimumBlockHeight: "10500", maximumBlockHeight: "12000" })
    .mockResolvedValueOnce({ minimumBlockHeight: "11001", maximumBlockHeight: "12000" });
  const result = await late.run(() => late.service.submit(request("submit", late.record.request)));
  expect(await result.json()).toMatchObject({ status: "awaiting-transfer-evidence" });
  expect(await db.getCreatorWithdrawalTransferClaim(late.record.id, late.record.owner)).not.toBeNull();
  await late.run(() => late.service.submit(request("submit", late.record.request)));
  expect(mocks.height).toHaveBeenCalledTimes(2); expect(fetcher).not.toHaveBeenCalled();
});

it("rechecks the live session after the final asynchronous height read", async () => {
  const f = await fixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  mocks.height.mockResolvedValueOnce({ minimumBlockHeight: "10500", maximumBlockHeight: "12000" })
    .mockImplementationOnce(async () => { await f.revoke(); return { minimumBlockHeight: "10500", maximumBlockHeight: "12000" }; });
  expect((await f.run(() => f.service.submit(request("submit", f.record.request)))).status).toBe(503);
  expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
