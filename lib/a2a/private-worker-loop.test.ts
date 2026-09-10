import { afterEach, expect, it, vi } from "vitest";
import { runPrivateWorkerLoop } from "./private-worker-loop";
afterEach(() => vi.useRealTimers());

it("withholds new work until recovery permits it and always closes the recovery scan", async () => {
  const tick = vi.fn(async () => ({ status: "busy" as const }));
  const recovery = { tick: vi.fn().mockResolvedValue({ status: "recovery", visited: 25, restored: 25, errors: 0, ready: false }), close: vi.fn() };
  const report = vi.fn(), signal = new AbortController().signal;
  await runPrivateWorkerLoop({ tick }, { signal, once: true, recovery, report });
  expect(tick).not.toHaveBeenCalled(); expect(recovery.close).toHaveBeenCalledTimes(1);
  recovery.tick.mockResolvedValue({ status: "recovery", visited: 0, restored: 0, errors: 0, ready: true });
  await runPrivateWorkerLoop({ tick }, { signal, once: true, recovery, report });
  expect(tick).toHaveBeenCalledTimes(1); expect(recovery.close).toHaveBeenCalledTimes(2);
});

it("drains an active tick on shutdown without starting another", async () => {
  const stop = new AbortController(), report = vi.fn();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const tick = vi.fn(async () => { await pending; return { status: "busy" as const }; });
  let ended = false;
  const loop = runPrivateWorkerLoop({ tick }, { signal: stop.signal, report }).then(() => { ended = true; });
  stop.abort(); await Promise.resolve();
  expect(ended).toBe(false);
  finish(); await loop;
  expect(tick).toHaveBeenCalledTimes(1);
  expect(report.mock.calls.map(([value]) => value.status)).toEqual(["busy", "stopped"]);
});

it("wakes immediately from idle polling on shutdown and leaves no timers", async () => {
  vi.useFakeTimers();
  const stop = new AbortController(), report = vi.fn();
  const tick = vi.fn(async () => ({ status: "busy" as const }));
  const loop = runPrivateWorkerLoop({ tick }, { signal: stop.signal, report });
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  stop.abort(); await loop;
  expect(tick).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it("redacts unexpected errors and supports exactly one tick or an already stopped signal", async () => {
  const report = vi.fn(), stop = new AbortController();
  const tick = vi.fn(async (): Promise<never> => { throw new Error("synthetic-private-provider-secret"); });
  await runPrivateWorkerLoop({ tick }, { signal: stop.signal, report, once: true });
  expect(report.mock.calls.map(([value]) => value)).toEqual([{ status: "tick-unavailable" }, { status: "stopped" }]);
  stop.abort(); await runPrivateWorkerLoop({ tick }, { signal: stop.signal, report });
  expect(tick).toHaveBeenCalledTimes(1);
});
