import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { checkWithdrawalRateLimit } from "./withdrawal-rate-limit";

const directory = mkdtempSync(join(tmpdir(), "keryx-withdrawal-limits-")), path = join(directory, "app.sqlite");
let db: SqliteAdapter, other: SqliteAdapter, tick = 0;
const owner = `0x${"11".repeat(20)}`;
beforeAll(async () => { db = new SqliteAdapter(path); await db.init(); other = new SqliteAdapter(path); await other.init(); }, 60000);
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000 + ++tick * 60001); });
afterEach(() => vi.restoreAllMocks());
afterAll(() => { db.close(); other.close(); rmSync(directory, { recursive: true, force: true }); });

it("shares the wallet budget across connections and keeps status recovery independent", async () => {
  const results = await Promise.all([db, other, db, other].map(store => checkWithdrawalRateLimit(store, owner, "submit")));
  expect(results.filter(value => value === null)).toHaveLength(3);
  const blocked = results.find(value => value !== null)!;
  expect(blocked.status).toBe(429); expect(blocked.headers.get("retry-after")).toBe("60");
  expect(await checkWithdrawalRateLimit(other, owner.toUpperCase().replace("0X", "0x"), "submit")).not.toBeNull();
  expect(await checkWithdrawalRateLimit(other, owner, "status")).toBeNull();
  other.close(); other = new SqliteAdapter(path); await other.init();
  expect((await checkWithdrawalRateLimit(other, owner, "submit"))?.status).toBe(429);
}, 60000);

it("enforces shared service capacity across distinct wallets without exceeding twenty admissions", async () => {
  const results = await Promise.all(Array.from({ length: 21 }, (_, index) =>
    checkWithdrawalRateLimit(index % 2 ? db : other, `0x${(index + 1).toString(16).padStart(40, "0")}`, "submit")));
  expect(results.filter(value => value === null)).toHaveLength(20);
  expect(results.find(value => value !== null)?.status).toBe(429);
});

it("retains a committed wallet point after readback loss and denies storage outages", async () => {
  const consume = db.consumeRateLimit.bind(db);
  vi.spyOn(db, "consumeRateLimit").mockImplementationOnce(async (...args) => {
    await consume(...args); throw new Error("private storage detail");
  });
  const lost = await checkWithdrawalRateLimit(db, owner, "submit");
  expect(lost?.status).toBe(503); expect(await lost!.text()).not.toContain("private storage detail");
  expect(await checkWithdrawalRateLimit(other, owner, "submit")).toBeNull();
  expect(await checkWithdrawalRateLimit(other, owner, "submit")).toBeNull();
  expect((await checkWithdrawalRateLimit(other, owner, "submit"))?.status).toBe(429);
  vi.spyOn(db, "consumeRateLimit").mockRejectedValue(new Error("private storage detail"));
  expect((await checkWithdrawalRateLimit(db, owner, "status"))?.status).toBe(503);
});

it("rejects a missing SQLite returning row rather than silently admitting a request", async () => {
  const native = (db as unknown as { db: DatabaseSync }).db, prepare = native.prepare.bind(native);
  vi.spyOn(native, "prepare").mockImplementation(sql => {
    const statement = prepare(sql);
    if (sql.includes("INSERT INTO rate_limit_counters")) vi.spyOn(statement, "get").mockReturnValueOnce(undefined);
    return statement;
  });
  await expect(db.consumeRateLimit("synthetic", 1, 60000, Date.now())).rejects.toThrow("readback unavailable");
  expect((await checkWithdrawalRateLimit(db, owner, "submit"))?.status).toBe(503);
});

it("rejects malformed decisions and opens a new window only after the stored deadline", async () => {
  vi.spyOn(db, "consumeRateLimit").mockResolvedValueOnce({ allowed: true, msBeforeNext: NaN });
  expect((await checkWithdrawalRateLimit(db, owner, "submit"))?.status).toBe(503);
  for (let index = 0; index < 3; index++) expect(await checkWithdrawalRateLimit(other, owner, "submit")).toBeNull();
  expect((await checkWithdrawalRateLimit(other, owner, "submit"))?.status).toBe(429);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60000);
  expect(await checkWithdrawalRateLimit(other, owner, "submit")).toBeNull();
});
