import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), start: vi.fn(), stop: vi.fn(), prune: vi.fn() }));
vi.mock("./lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("./lib/db/indexer", () => ({ startIndexer: mocks.start }));
vi.mock("./lib/payments/session-grants", () => ({ pruneExpiredGrants: mocks.prune }));
beforeEach(() => {
  vi.resetModules(); vi.stubEnv("NEXT_RUNTIME", "nodejs");
  mocks.getDb.mockReset().mockResolvedValue({ fixture: true });
  mocks.stop.mockReset().mockResolvedValue(undefined);
  mocks.start.mockReset().mockReturnValue(mocks.stop);
  mocks.prune.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

it("retains the boot owner's cleanup and makes repeated register/close idempotent", async () => {
  const app = await import("./instrumentation");
  const registered = app.register(); expect(app.register()).toBe(registered); await registered;
  const closed = app.close(); expect(app.close()).toBe(closed); expect(await closed).toBe(true);
  expect(mocks.getDb).toHaveBeenCalledOnce(); expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.prune).toHaveBeenCalledOnce(); expect(mocks.stop).toHaveBeenCalledOnce();
  await app.register(); expect(mocks.start).toHaveBeenCalledTimes(2);
  expect(await app.close()).toBe(true); expect(mocks.stop).toHaveBeenCalledTimes(2);
});

it("waits for admitted boot and the indexer's actual drain before resolving close", async () => {
  let releaseDb!: (db: object) => void, releaseStop!: () => void;
  mocks.getDb.mockReturnValue(new Promise(resolve => { releaseDb = resolve; }));
  mocks.stop.mockReturnValue(new Promise<void>(resolve => { releaseStop = resolve; }));
  const app = await import("./instrumentation");
  const registered = app.register();
  await vi.waitFor(() => expect(mocks.getDb).toHaveBeenCalledOnce());
  let closed = false;
  const closing = app.close(); void closing.then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false); expect(mocks.stop).not.toHaveBeenCalled();
  releaseDb({ fixture: true }); await registered;
  await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
  expect(closed).toBe(false); releaseStop(); expect(await closing).toBe(true);
});

it("preserves a cleanup refusal instead of reporting completion", async () => {
  mocks.stop.mockRejectedValue(new Error("Synthetic indexer drain refusal"));
  const app = await import("./instrumentation"); await app.register();
  const closed = app.close(); expect(app.close()).toBe(closed);
  await expect(closed).rejects.toThrow("Synthetic indexer drain refusal");
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it("keeps the Edge runtime free of Node storage and indexer effects", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge");
  const app = await import("./instrumentation"); await app.register();
  expect(await app.close()).toBe(false);
  expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.prune).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled();
});
