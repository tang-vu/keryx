import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { issueWebSession, parseWebSession, webSessionHash } from "../auth-session";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn(), admit: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/config", async importOriginal => {
  const actual = await importOriginal<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, jwtSecret: "synthetic-withdrawal-session" } };
});
vi.mock("./withdrawal-admission-bootstrap", () => ({ createWithdrawalRuntimeAdmission: () => mocks.admit }));
import { createWithdrawalHttpService } from "./withdrawal-http-service";

const directory = mkdtempSync(join(tmpdir(), "keryx-withdrawal-http-"));
const db = new SqliteAdapter(join(directory, "app.sqlite"));
const storage = new AsyncLocalStorage<{ token?: string }>(), secret = "synthetic-withdrawal-session";
beforeAll(async () => {
  await db.init(); mocks.db.mockResolvedValue(db);
  mocks.cookies.mockImplementation(async () => ({ get: () => ({ value: storage.getStore()?.token }) }));
}, 60000);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.admit.mockReset(); });
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const request = (kind: string, body: unknown) => new Request(`https://keryx.test/api/me/withdrawals/${kind}`, {
  method: "POST", headers: { host: "keryx.test", origin: "https://keryx.test", "content-type": "application/json" }, body: JSON.stringify(body) });
async function fixture() {
  const f = await creatorWithdrawalFixture(), session = await issueWebSession(db, secret, f.record.owner, "creator");
  const { owner: _owner, recipient: _recipient, ...limits } = f.record.policy; void _owner; void _recipient;
  const options = { env: {}, network: "eip155:5042002", rpcUrl: "https://rpc.synthetic.invalid", ceilingWei: "1", limits };
  const service = createWithdrawalHttpService(options), state = { token: session.token };
  return { ...f, state, service, options, run: <T>(fn: () => T) => storage.run(state, fn),
    revoke: async () => db.revokeWebSession(webSessionHash((await parseWebSession(session.token, secret))!.jti), f.record.owner) };
}

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
