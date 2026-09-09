import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { issueWebSession, parseWebSession, webSessionHash } from "../auth-session";
import type { A2aOrder } from "../a2a/order";
import { encodeHistoryCursor } from "../a2a/account-history";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/config", () => ({ config: { jwtSecret: "synthetic-history-secret" } }));
import { GET } from "@/app/api/me/jobs/route";
const root = mkdtempSync(join(tmpdir(), "keryx-history-")), file = join(root, "db.sqlite");
const db = new SqliteAdapter(file); await db.init();
const storage = new AsyncLocalStorage<string | undefined>();
const wallet = `0x${"a".repeat(40)}`, foreign = `0x${"b".repeat(40)}`;
const secret = "synthetic-history-secret";
function order(index: number, payer = wallet): A2aOrder {
  const id = `a2a_${index.toString(16).padStart(64, "0")}`;
  return { id, queryId: id, authorizationId: "synthetic-authorization-private", requestHash: "synthetic-request-hash", payer, payee: foreign,
    amountUsdc: 0.05, creatorBudgetUsdc: 0.03, serviceFeeUsdc: 0.02, researchMode: "deep", researchPackage: null,
    status: "running", transaction: "synthetic-transaction", request: { question: `Owner question ${index}`, origin: "a2a" },
    startedAt: null, workerId: "synthetic-private-worker", executionJournalVersion: 1, paymentStartedAt: null, resultSavingAt: null,
    response: { privateField: "raw-response-not-for-history" }, errorCode: null, resolution: null,
    createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z" };
}
beforeEach(() => {
  mocks.cookies.mockImplementation(async () => ({ get: () => storage.getStore() ? { value: storage.getStore() } : undefined }));
  mocks.db.mockResolvedValue(db);
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => { db.close(); for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true }); rmdirSync(root); });
const read = (token?: string, query = "") => storage.run(token, () => GET(new Request(`https://keryx.cc/api/me/jobs${query}`)));

it("uses verified payer identity and pages through equal timestamps without gaps or foreign rows", async () => {
  for (let index = 1; index <= 27; index++) await db.createA2aOrder(order(index, index % 2 ? wallet.toUpperCase() : wallet));
  await db.createA2aOrder(order(99, foreign));
  const { token } = await issueWebSession(db, secret, wallet, "asker");
  const response = await read(token, `?wallet=${foreign}`); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const first = await response.json(); expect(first.jobs).toHaveLength(25); expect(first.wallet).toBe(wallet);
  expect(JSON.stringify(first)).not.toContain("synthetic-authorization");
  expect(JSON.stringify(first)).not.toContain("synthetic-private-worker");
  expect(JSON.stringify(first)).not.toContain("raw-response-not-for-history");
  await db.createA2aOrder({ ...order(100), createdAt: "2026-09-09T01:00:00.000Z" });
  const second = await (await read(token, `?cursor=${first.nextCursor}`)).json();
  expect(second.jobs).toHaveLength(2); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.jobs, ...second.jobs].map(row => row.id)).size).toBe(27);
  const forged = encodeHistoryCursor(order(99, foreign));
  const forgedPage = await (await read(token, `?cursor=${forged}`)).json();
  expect(forgedPage.jobs.some((row: { id: string }) => row.id === order(99, foreign).id)).toBe(false);
});

it("denies anonymous/revoked sessions, malformed cursors and storage failures", async () => {
  expect((await read()).status).toBe(401);
  const { token } = await issueWebSession(db, secret, wallet, "asker");
  expect((await read(token, "?cursor=bad!")).status).toBe(400);
  const outage = vi.spyOn(db, "listA2aOrdersByPayer").mockRejectedValue(new Error("synthetic outage"));
  expect((await read(token)).status).toBe(503); outage.mockRestore();
  const wrongOwner = vi.spyOn(db, "listA2aOrdersByPayer").mockResolvedValue([order(99, foreign)]);
  expect((await read(token)).status).toBe(503); wrongOwner.mockRestore();
  const claims = (await parseWebSession(token, secret))!;
  await db.revokeWebSession(webSessionHash(claims.jti), wallet);
  expect((await read(token)).status).toBe(401);
});

it("keeps failed, queued, processing and review-needed orders visible even without saved research", async () => {
  const owner = `0x${"c".repeat(40)}`;
  await db.createA2aOrder({ ...order(200, owner), status: "failed", request: null });
  await db.createA2aOrder(order(201, owner));
  await db.createA2aOrder({ ...order(202, owner), startedAt: new Date().toISOString() });
  await db.createA2aOrder({ ...order(203, owner), startedAt: "2026-01-01T00:00:00.000Z" });
  const { token } = await issueWebSession(db, secret, owner, "asker");
  const body = await (await read(token)).json();
  expect(body.jobs.map((row: { status: string }) => row.status).sort()).toEqual(["failed", "processing", "queued", "review_required"]);
  expect(body.jobs.find((row: { status: string }) => row.status === "failed").question).toBeNull();
});
