import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalStatusHandler } from "./withdrawal-status-handler";

const directory = mkdtempSync(join(tmpdir(), "keryx-withdrawal-status-"));
let db: SqliteAdapter;
beforeAll(async () => { db = new SqliteAdapter(join(directory, "app.sqlite")); await db.init(); }, 60000);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const request = (body: unknown, extra: RequestInit = {}) => new Request("https://keryx.test/api/me/withdrawals/status", {
  method: "POST", headers: { host: "keryx.test", origin: "https://keryx.test", "content-type": "application/json" },
  body: JSON.stringify(body), ...extra,
});
const signedOut = () => Response.json({ error: "Sign in to access your account." }, { status: 401, headers: { "Cache-Control": "no-store" } });

it("returns private owner-scoped transfer progress without giving stored evidence mint authority", async () => {
  const f = await creatorWithdrawalFixture(); await db.reserveCreatorWithdrawal(f.record);
  const claim = (await db.claimCreatorWithdrawalTransfer(f.record.id, f.record.owner))!;
  await db.saveCreatorWithdrawalAttestation(f.record.id, f.record.owner, claim.claimId, f.response);
  const authenticate = vi.fn(async () => ({ db, wallet: f.record.owner }));
  const response = await createWithdrawalStatusHandler(authenticate)(request({ id: f.record.id }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ wallet: f.record.owner, requestId: f.record.id, recipient: f.record.policy.recipient,
    amountMicros: f.record.request.burnIntent.spec.value, status: "attestation-stored", chainFinalityVerified: false, mintStatus: "not-checked" });
  expect(authenticate).toHaveBeenCalledTimes(2);
});

it("does not claim, settle or persist anything when reading an unsent original", async () => {
  const f = await creatorWithdrawalFixture(); await db.reserveCreatorWithdrawal(f.record);
  const claim = vi.spyOn(db, "claimCreatorWithdrawalTransfer"), save = vi.spyOn(db, "saveCreatorWithdrawalAttestation");
  const handler = createWithdrawalStatusHandler(async () => ({ db, wallet: f.record.owner }));
  for (let n = 0; n < 2; n++) expect(await (await handler(request({ id: f.record.id }))).json()).toMatchObject({ status: "request-stored" });
  expect(claim).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  expect(await db.getCreatorWithdrawalTransferClaim(f.record.id, f.record.owner)).toBeNull();
});

it("gives the same unavailable response for a foreign owner and missing request", async () => {
  const f = await creatorWithdrawalFixture(); await db.reserveCreatorWithdrawal(f.record);
  const handler = createWithdrawalStatusHandler(async () => ({ db, wallet: `0x${"00".repeat(20)}` }));
  const foreign = await handler(request({ id: f.record.id }));
  const missing = await handler(request({ id: `0x${"00".repeat(32)}` }));
  expect(foreign.status).toBe(404); expect(missing.status).toBe(404); expect(await foreign.json()).toEqual(await missing.json());
});

it("denies revoked or switched sessions before releasing data already read", async () => {
  const f = await creatorWithdrawalFixture(); await db.reserveCreatorWithdrawal(f.record);
  for (const fresh of [signedOut(), { db, wallet: `0x${"00".repeat(20)}` }]) {
    let calls = 0;
    const handler = createWithdrawalStatusHandler(async () => ++calls === 1 ? { db, wallet: f.record.owner } : fresh);
    const response = await handler(request({ id: f.record.id }));
    expect(response.status).toBe(401); expect(await response.text()).not.toContain(f.record.id);
  }
});

it("requires authentication and a same-origin POST with selectors only in its JSON body", async () => {
  const authenticate = vi.fn(async () => signedOut()), handler = createWithdrawalStatusHandler(authenticate);
  expect((await handler(new Request("https://keryx.test/api/me/withdrawals/status"))).status).toBe(405);
  expect((await handler(request({}, { headers: { host: "keryx.test", origin: "https://foreign.test" } }))).status).toBe(403);
  expect(authenticate).not.toHaveBeenCalled();
  expect((await handler(request({}))).status).toBe(401);
  const query = new Request("https://keryx.test/api/me/withdrawals/status?id=private", { method: "POST" });
  expect((await handler(query)).status).toBe(400);
});

it("rejects extra authority fields and oversized chunked input before withdrawal reads", async () => {
  const f = await creatorWithdrawalFixture(), read = vi.spyOn(db, "getCreatorWithdrawal");
  const handler = createWithdrawalStatusHandler(async () => ({ db, wallet: f.record.owner }));
  expect((await handler(request({ id: f.record.id, owner: f.record.owner }))).status).toBe(400);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(" ".repeat(1025))); controller.close(); } });
  expect((await handler(request({}, { body: stream, duplex: "half" } as RequestInit))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});

it("does not extend the body deadline for a stalled cancellation promise", async () => {
  const f = await creatorWithdrawalFixture(); vi.useFakeTimers();
  const stream = new ReadableStream({ cancel: () => new Promise(() => {}) });
  const handler = createWithdrawalStatusHandler(async () => ({ db, wallet: f.record.owner }));
  const pending = handler(request({}, { body: stream, duplex: "half" } as RequestInit));
  await vi.advanceTimersByTimeAsync(5001);
  expect((await pending).status).toBe(400);
});

it("keeps database failure details out of the HTTP response", async () => {
  const f = await creatorWithdrawalFixture();
  vi.spyOn(db, "getCreatorWithdrawal").mockRejectedValueOnce(new Error("private database marker"));
  const response = await createWithdrawalStatusHandler(async () => ({ db, wallet: f.record.owner }))(request({ id: f.record.id }));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("private database marker");
});
