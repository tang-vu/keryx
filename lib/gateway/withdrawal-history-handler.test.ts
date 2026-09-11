import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalHistoryHandler } from "./withdrawal-history-handler";

const directory = mkdtempSync(join(tmpdir(), "keryx-history-handler-"));
let db: SqliteAdapter;
beforeAll(async () => { db = new SqliteAdapter(join(directory, "app.sqlite")); await db.init(); }, 60000);
afterEach(() => vi.restoreAllMocks());
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const currentId = "a".repeat(64);
const request = (body: unknown = {}, extra: RequestInit = {}) => new Request("https://keryx.test/api/me/withdrawals/history", {
  method: "POST", headers: { host: "keryx.test", origin: "https://keryx.test", "content-type": "application/json" },
  body: JSON.stringify(body), ...extra,
});
const signedOut = () => Response.json({ error: "Sign in." }, { status: 401 });
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Cookie, Origin");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

it("lists only the authenticated owner's stored originals without payment authority or signatures", async () => {
  const own = await creatorWithdrawalFixture(), foreign = await creatorWithdrawalFixture();
  await db.reserveCreatorWithdrawal(own.record); await db.reserveCreatorWithdrawal(foreign.record);
  const authenticate = vi.fn(async () => ({ db, wallet: own.record.owner, currentId }));
  const response = await createWithdrawalHistoryHandler(authenticate)(request());
  expect(response.status).toBe(200); privateHeaders(response);
  expect(await response.json()).toEqual({ wallet: own.record.owner, nextCursor: null, requests: [{
    id: own.record.id, owner: own.record.owner, createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    amountMicros: own.record.request.burnIntent.spec.value, maxFeeMicros: own.record.request.burnIntent.maxFee,
    recipient: own.record.policy.recipient,
  }] });
  expect(authenticate).toHaveBeenCalledTimes(2);
  expect(await db.getCreatorWithdrawalTransferClaim(own.record.id, own.record.owner)).toBeNull();
});

it("withholds an already-read page after revocation, wallet switch, or same-wallet session replacement", async () => {
  const f = await creatorWithdrawalFixture(); await db.reserveCreatorWithdrawal(f.record);
  for (const fresh of [signedOut(), { db, wallet: `0x${"11".repeat(20)}`, currentId },
    { db, wallet: f.record.owner, currentId: "b".repeat(64) }]) {
    let calls = 0;
    const response = await createWithdrawalHistoryHandler(async () => ++calls === 1
      ? { db, wallet: f.record.owner, currentId } : fresh)(request());
    expect(response.status).toBe(401); privateHeaders(response);
    expect(await response.text()).not.toContain(f.record.id);
  }
});

it("rejects public selectors, cross-origin calls, and missing authentication before reading storage", async () => {
  const authenticate = vi.fn(async () => signedOut());
  const handler = createWithdrawalHistoryHandler(authenticate);
  for (const [input, status] of [
    [new Request("https://keryx.test/api/me/withdrawals/history"), 405],
    [new Request("https://keryx.test/api/me/withdrawals/history?cursor=private", { method: "POST" }), 400],
    [request({}, { headers: { host: "keryx.test", origin: "https://foreign.test" } }), 403],
    [request({}, { headers: { host: "keryx.test", origin: "https://keryx.test/path" } }), 403],
    [request({}, { headers: { host: "keryx.test" } }), 403],
  ] as const) {
    const response = await handler(input); expect(response.status).toBe(status); privateHeaders(response);
  }
  expect(authenticate).not.toHaveBeenCalled();
  const response = await handler(request()); expect(response.status).toBe(401); privateHeaders(response);
});

it("rejects caller-selected owners, page sizes, malformed cursors and oversized bodies before database reads", async () => {
  const f = await creatorWithdrawalFixture(), read = vi.spyOn(db, "listCreatorWithdrawalHistory");
  const handler = createWithdrawalHistoryHandler(async () => ({ db, wallet: f.record.owner, currentId }));
  for (const body of [{ owner: f.record.owner }, { limit: 100 }, { cursor: { id: f.record.id, createdAt: "now,owner.eq.foreign" } }])
    expect((await handler(request(body))).status).toBe(400);
  expect((await handler(request({}, { body: " ".repeat(1025) }))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});

it("passes a bounded body cursor and strips unexpected adapter payloads", async () => {
  const f = await creatorWithdrawalFixture(); await db.reserveCreatorWithdrawal(f.record);
  const page = await db.listCreatorWithdrawalHistory(f.record.owner);
  const cursor = { id: f.record.id, createdAt: page.requests[0].createdAt };
  const read = vi.spyOn(db, "listCreatorWithdrawalHistory").mockResolvedValue({ ...page,
    requests: page.requests.map(row => ({ ...row, signature: "private bearer marker" })), nextCursor: cursor });
  const response = await createWithdrawalHistoryHandler(async () => ({ db, wallet: f.record.owner, currentId }))(request({ cursor }));
  expect(response.status).toBe(200); expect(await response.text()).not.toContain("private bearer marker");
  expect(read).toHaveBeenCalledWith(f.record.owner, cursor, 25);
});

it("fails closed on foreign, duplicate or inconsistent adapter pages and hides database error details", async () => {
  const f = await creatorWithdrawalFixture(); await db.reserveCreatorWithdrawal(f.record);
  const page = await db.listCreatorWithdrawalHistory(f.record.owner), row = page.requests[0];
  const read = vi.spyOn(db, "listCreatorWithdrawalHistory");
  const handler = createWithdrawalHistoryHandler(async () => ({ db, wallet: f.record.owner, currentId }));
  for (const invalid of [
    { ...page, requests: [{ ...row, owner: `0x${"22".repeat(20)}` }] },
    { ...page, requests: [row, row] },
    { ...page, nextCursor: { id: `0x${"33".repeat(32)}` as const, createdAt: row.createdAt } },
  ]) {
    read.mockResolvedValueOnce(invalid);
    const response = await handler(request()); expect(response.status).toBe(503); privateHeaders(response);
    expect(await response.text()).not.toContain(row.id);
  }
  read.mockRejectedValueOnce(new Error("private database marker"));
  expect(await (await handler(request())).text()).not.toContain("private database marker");
});

it("withholds data when cancelled during its storage read", async () => {
  const f = await creatorWithdrawalFixture(), controller = new AbortController();
  vi.spyOn(db, "listCreatorWithdrawalHistory").mockImplementationOnce(async () => {
    controller.abort(); return { requests: [], nextCursor: null };
  });
  const response = await createWithdrawalHistoryHandler(async () => ({ db, wallet: f.record.owner, currentId }))(
    request({}, { signal: controller.signal }));
  expect(response.status).toBe(408); privateHeaders(response);
});

it("uses a separate durable history quota and stops before storage when it is exhausted", async () => {
  const f = await creatorWithdrawalFixture();
  const consume = vi.spyOn(db, "consumeRateLimit"), read = vi.spyOn(db, "listCreatorWithdrawalHistory");
  const handler = createWithdrawalHistoryHandler(async () => ({ db, wallet: f.record.owner, currentId }));
  for (let i = 0; i < 10; i++) expect((await handler(request())).status).toBe(200);
  const response = await handler(request()); expect(response.status).toBe(429); privateHeaders(response);
  expect(response.headers.get("retry-after")).toBeTruthy(); expect(read).toHaveBeenCalledTimes(10);
  expect(consume.mock.calls[0][0]).toMatch(/^withdrawal:history:wallet:/);
  expect(consume.mock.calls[0][1]).toBe(10);
});
