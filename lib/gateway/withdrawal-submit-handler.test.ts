import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalSubmitHandler } from "./withdrawal-submit-handler";

const directory = mkdtempSync(join(tmpdir(), "keryx-withdrawal-submit-")); let db: SqliteAdapter;
beforeAll(async () => { db = new SqliteAdapter(join(directory, "app.sqlite")); await db.init(); }, 60000);
afterEach(() => vi.restoreAllMocks());
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const request = (body: unknown, extra: RequestInit = {}) => new Request("https://keryx.test/api/me/withdrawals/submit", {
  method: "POST", headers: { host: "keryx.test", origin: "https://keryx.test", "content-type": "application/json" }, body: JSON.stringify(body), ...extra });
async function fixture() {
  const f = await creatorWithdrawalFixture(); let session = "original-session";
  const { owner: _owner, recipient: _recipient, ...limits } = f.record.policy; void _owner; void _recipient;
  const options = { limits, authenticate: async () => ({ db, wallet: f.record.owner, currentId: session }),
    limit: vi.fn(async (): Promise<Response | null> => null), admit: vi.fn(async () => {}), transfer: vi.fn(async () => f.response) };
  return { ...f, options, changeSession: () => { session = "replacement-session"; } };
}

it("derives the original policy from server limits and persists one transfer across duplicate HTTP calls", async () => {
  const f = await fixture(), handler = createWithdrawalSubmitHandler(f.options);
  const responses = await Promise.all([handler(request(f.record.request)), handler(request(f.record.request))]);
  expect(responses.map(response => response.status)).toEqual([202, 202]);
  expect(f.options.transfer).toHaveBeenCalledTimes(1);
  expect(await db.getCreatorWithdrawal(f.record.id, f.record.owner)).toEqual(f.record);
  const response = await handler(request(f.record.request));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ requestId: f.record.id, status: "attestation-stored", mintStatus: "not-checked", chainFinalityVerified: false });
});

it("rejects caller policy fields, excessive values and excessive fee limits before admission", async () => {
  const f = await fixture();
  const handler = createWithdrawalSubmitHandler({ ...f.options, limits: { ...f.options.limits, maxValueMicros: "1" } });
  expect((await handler(request(f.record.request))).status).toBe(400);
  expect((await createWithdrawalSubmitHandler(f.options)(request({ ...f.record.request, policy: f.record.policy }))).status).toBe(400);
  expect((await createWithdrawalSubmitHandler({ ...f.options, limits: { ...f.options.limits, maxFeeMicros: "0" } })(request(f.record.request))).status).toBe(400);
  expect(f.options.admit).not.toHaveBeenCalled(); expect(f.options.transfer).not.toHaveBeenCalled();
  expect(await db.getCreatorWithdrawal(f.record.id, f.record.owner)).toBeNull();
});

it("rejects a valid foreign signature and obeys limiter denial without creating a request", async () => {
  const f = await fixture();
  const handler = createWithdrawalSubmitHandler({ ...f.options, authenticate: async () => ({ db, wallet: `0x${"00".repeat(20)}`, currentId: "other" }) });
  expect((await handler(request(f.record.request))).status).toBe(400);
  f.options.limit.mockResolvedValueOnce(Response.json({ error: "Limited" }, { status: 429 }));
  const denied = await createWithdrawalSubmitHandler(f.options)(request(f.record.request));
  expect(denied.status).toBe(429); expect(denied.headers.get("cache-control")).toBe("no-store");
  expect(await db.getCreatorWithdrawal(f.record.id, f.record.owner)).toBeNull();
});

it("denies a replacement session after gas admission, even for the same wallet", async () => {
  const f = await fixture(); f.options.admit.mockImplementationOnce(async () => { f.changeSession(); });
  expect((await createWithdrawalSubmitHandler(f.options)(request(f.record.request))).status).toBe(503);
  expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).toBeNull();
  expect(f.options.transfer).not.toHaveBeenCalled();
});

it("retains a consumed claim when the session changes during claim storage", async () => {
  const f = await fixture(), claim = db.claimCreatorWithdrawalTransfer.bind(db);
  vi.spyOn(db, "claimCreatorWithdrawalTransfer").mockImplementationOnce(async (...args) => {
    const result = await claim(...args); f.changeSession(); return result;
  });
  expect((await createWithdrawalSubmitHandler(f.options)(request(f.record.request))).status).toBe(503);
  expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).not.toBeNull();
  expect(f.options.transfer).not.toHaveBeenCalled();
  await createWithdrawalSubmitHandler(f.options)(request(f.record.request));
  expect(f.options.transfer).not.toHaveBeenCalled();
});

it("keeps vendor-response loss pending and does not repeat admission or transfer on recovery", async () => {
  const f = await fixture(); f.options.transfer.mockRejectedValueOnce(new Error("private vendor detail"));
  const handler = createWithdrawalSubmitHandler(f.options);
  const first = await handler(request(f.record.request));
  expect(await first.json()).toMatchObject({ status: "awaiting-transfer-evidence" });
  const admits = f.options.admit.mock.calls.length;
  await handler(request(f.record.request));
  expect(f.options.admit).toHaveBeenCalledTimes(admits); expect(f.options.transfer).toHaveBeenCalledTimes(1);
});

it("requires same-origin POST and rejects oversized input", async () => {
  const f = await fixture(), handler = createWithdrawalSubmitHandler(f.options);
  expect((await handler(new Request("https://keryx.test/"))).status).toBe(405);
  expect((await handler(request(f.record.request, { headers: { origin: "https://foreign.test", host: "keryx.test" } }))).status).toBe(403);
  expect((await handler(request({ padding: "x".repeat(8193) }))).status).toBe(400);
  expect(f.options.transfer).not.toHaveBeenCalled();
});
