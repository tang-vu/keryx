import { afterEach, expect, it, vi } from "vitest";
import { runPrivateWorkerLoop } from "./private-worker-loop";
afterEach(() => vi.useRealTimers());

it("records lifecycle boundaries and does not start work when the pre-work status write fails", async () => {
  const report = vi.fn(), signal = new AbortController().signal;
  const tick = vi.fn(async () => ({ status: "processed" as const, visited: 0, completed: 0, stored: 0, alreadyClaimed: 0, unpersisted: 0, errors: 0,
    providerServedJobs: 0, providerFailedJobs: 0, fallbackJobs: 0, reasoningUnknownJobs: 0 }));
  const observe = vi.fn(async (_phase: string) => {});
  await runPrivateWorkerLoop({ tick }, { signal, once: true, report, observe });
  expect(observe.mock.calls.flat()).toEqual(["starting", "working", "idle", "stopped"]);
  tick.mockClear(); observe.mockClear();
  observe.mockImplementation(async phase => { if (phase === "working") throw new Error("Synthetic private filesystem failure"); });
  await runPrivateWorkerLoop({ tick }, { signal, once: true, report, observe });
  expect(tick).not.toHaveBeenCalled();
  expect(observe.mock.calls.flat()).toEqual(["starting", "working", "degraded", "stopped"]);
  expect(report).toHaveBeenCalledWith({ status: "tick-unavailable" });
});

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

it("runs recovery then reconciliation before execution and drains reconciliation on shutdown", async () => {
  const events: string[] = [], stop = new AbortController();
  const counts = { status: "reconciliation" as const, visited: 1, incomingConfirmed: 0, creatorConfirmed: 0,
    processing: 0, awaiting: 1, failedObserved: 0, mismatched: 0, errors: 0, remainingLegs: 0, allocationsReleased: 0 };
  const recovery = { tick: vi.fn(async () => { events.push("recover"); return { status: "recovery" as const, visited: 0, restored: 0, errors: 0, ready: true }; }), close: vi.fn() };
  const reconciliation = { tick: vi.fn(async () => { events.push("reconcile"); return counts; }) };
  const worker = { tick: vi.fn(async () => { events.push("execute"); return { status: "busy" as const }; }) };
  await runPrivateWorkerLoop(worker, { signal: stop.signal, once: true, report: vi.fn(), recovery, reconciliation });
  expect(events).toEqual(["recover", "reconcile", "execute"]);
  let finish!: () => void;
  reconciliation.tick.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return counts; });
  const running = runPrivateWorkerLoop(worker, { signal: stop.signal, report: vi.fn(), reconciliation });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  stop.abort(); finish(); await running;
  expect(worker.tick).toHaveBeenCalledTimes(1);
});

it("keeps reconciliation failures visible even when independent paid work succeeds", async () => {
  const observe = vi.fn(async (_phase: string) => {}), report = vi.fn();
  const worker = { tick: vi.fn(async () => ({ status: "processed" as const, visited: 0, completed: 0, stored: 0,
    alreadyClaimed: 0, unpersisted: 0, errors: 0, providerServedJobs: 0, providerFailedJobs: 0, fallbackJobs: 0, reasoningUnknownJobs: 0 })) };
  const reconciliation = { tick: vi.fn(async () => ({ status: "reconciliation" as const, visited: 1,
    incomingConfirmed: 0, creatorConfirmed: 0, processing: 0, awaiting: 0, failedObserved: 0, mismatched: 1, errors: 0, remainingLegs: 0, allocationsReleased: 0 })) };
  await runPrivateWorkerLoop(worker, { signal: new AbortController().signal, once: true, reconciliation, observe, report });
  expect(worker.tick).toHaveBeenCalledTimes(1);
  expect(observe.mock.calls.flat()).toEqual(["starting", "working", "degraded", "stopped"]);
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: "reconciliation", mismatched: 1 }));
});
