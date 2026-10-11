import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syntheticA2aOriginal } from "../lib/db/a2a-original-fixture";

const storage = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock("../lib/db/application-storage.ts", () => ({
  createReadonlyApplicationStorage: storage.open, closeReadonlyApplicationStorage: storage.close,
}));
const originalArgs = process.argv, originalExit = process.exitCode;
beforeEach(() => { vi.resetModules(); storage.open.mockReset(); storage.close.mockReset(); process.exitCode = undefined; });
afterEach(() => { process.argv = originalArgs; process.exitCode = originalExit; vi.restoreAllMocks(); });

async function run(args: string[]) {
  process.argv = ["node", "operator-overdue-jobs.mts", ...args];
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await import("./operator-overdue-jobs.mts");
  return { log, error };
}

it("does not open storage for help or malformed arguments", async () => {
  const help = await run(["--help"]);
  expect(help.log).toHaveBeenCalledWith(expect.stringContaining("no schedule is created"));
  expect(storage.open).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.resetModules();
  await run(["--limit", "501"]);
  expect(process.exitCode).toBe(1);
  expect(storage.open).not.toHaveBeenCalled();
});

it("prints a private attention packet with exit 2 and always disposes the selected reader", async () => {
  const original = syntheticA2aOriginal().order;
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(original.createdAt) + 180_001);
  const db = { listUnfinishedA2aOrders: vi.fn().mockResolvedValue({ orders: [original], unreadable: 0, truncated: false }),
    listCreatorPaymentAttemptsByQuery: vi.fn().mockResolvedValue([]) };
  storage.open.mockResolvedValue(db);
  const { log, error } = await run(["--limit", "10"]);
  expect(process.exitCode).toBe(2);
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ attentionNeeded: true, notification: "none", authority: "read_only" });
  expect(storage.close).toHaveBeenCalledExactlyOnceWith(db);
  expect(db.listUnfinishedA2aOrders).toHaveBeenCalledExactlyOnceWith(10);
  expect(error).not.toHaveBeenCalled();
});

it("reports unavailable observation privately and closes a reader after its read fails", async () => {
  const db = { listUnfinishedA2aOrders: vi.fn().mockRejectedValue(new Error("PRIVATE_STORAGE_DETAIL")) };
  storage.open.mockResolvedValue(db);
  const { log, error } = await run([]);
  expect(process.exitCode).toBe(1);
  expect(log).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith("Overdue paid-job observation unavailable. No conclusion about unfinished jobs can be drawn.");
  expect(storage.close).toHaveBeenCalledExactlyOnceWith(db);
});

it("refuses absent selected storage and uses exit 0 only for a complete empty observation", async () => {
  storage.open.mockResolvedValue(undefined);
  await run([]);
  expect(process.exitCode).toBe(1);
  expect(storage.close).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.resetModules();
  const db = { listUnfinishedA2aOrders: vi.fn().mockResolvedValue({ orders: [], unreadable: 0, truncated: false }) };
  storage.open.mockResolvedValue(db);
  const { log } = await run([]);
  expect(process.exitCode).toBe(0);
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ scanned: 0, attentionNeeded: false });
  expect(storage.close).toHaveBeenCalledExactlyOnceWith(db);
});
