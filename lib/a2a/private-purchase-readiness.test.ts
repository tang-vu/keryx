import { afterEach, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import { readyPrivatePurchaseService } from "./private-purchase-readiness";

afterEach(() => vi.useRealTimers());
const db = {} as KeryxDB;
const service = { quote: vi.fn(), submit: vi.fn() };

it("awaits server readiness and never invokes payment while checking it", async () => {
  let finish!: (value: typeof service) => void;
  const pending = new Promise<typeof service>(resolve => { finish = resolve; });
  const bootstrap = vi.fn(async (_db: KeryxDB, _signal: AbortSignal) => pending);
  let completed = false;
  const result = readyPrivatePurchaseService(bootstrap, db, new AbortController().signal).then(value => { completed = true; return value; });
  await Promise.resolve(); expect(completed).toBe(false);
  expect(bootstrap.mock.calls[0][0]).toBe(db);
  finish(service); expect(await result).toBe(service);
  expect(service.submit).not.toHaveBeenCalled();
});

it("times out a stalled check, signals cancellation and discards a late ready result", async () => {
  vi.useFakeTimers();
  let finish!: (value: typeof service) => void;
  const pending = new Promise<typeof service>(resolve => { finish = resolve; });
  const bootstrap = vi.fn(async (_db: KeryxDB, _signal: AbortSignal) => pending);
  const result = readyPrivatePurchaseService(bootstrap, db, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toBeNull(); expect(bootstrap.mock.calls[0][1].aborted).toBe(true);
  finish(service); await Promise.resolve();
  expect(service.submit).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("fails closed on errors and cancellation without calling an already-cancelled bootstrap", async () => {
  const stop = new AbortController(); stop.abort();
  const bootstrap = vi.fn(async () => service);
  expect(await readyPrivatePurchaseService(bootstrap, db, stop.signal)).toBeNull();
  expect(bootstrap).not.toHaveBeenCalled();
  expect(await readyPrivatePurchaseService(async () => { throw new Error("Synthetic private readiness detail"); }, db, new AbortController().signal)).toBeNull();
  const active = new AbortController();
  const result = readyPrivatePurchaseService(async () => new Promise<never>(() => {}), db, active.signal);
  active.abort(); expect(await result).toBeNull();
});
