import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startActivityPolling } from "../components/keryx/activity-polling";

class Visibility extends EventTarget {
  hidden = false;
  setHidden(value: boolean) { this.hidden = value; this.dispatchEvent(new Event("visibilitychange")); }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(hidden = false) {
  const visibility = new Visibility(); visibility.hidden = hidden;
  const calls: { signal: AbortSignal; result: ReturnType<typeof deferred<string[]>> }[] = [];
  const read = vi.fn((signal: AbortSignal) => {
    const result = deferred<string[]>(); calls.push({ signal, result }); return result.promise;
  });
  const receive = vi.fn(), unavailable = vi.fn();
  const stop = startActivityPolling({ read, receive, unavailable, visibility });
  return { visibility, calls, read, receive, unavailable, stop };
}
const cleanups: (() => void)[] = [];
function drive(hidden = false) { const f = fixture(hidden); cleanups.push(f.stop); return f; }
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const stop of cleanups.splice(0)) stop(); vi.useRealTimers(); });

it("reads immediately when visible and keeps the existing 20 second cadence after success", async () => {
  const f = drive(); expect(f.read).toHaveBeenCalledOnce();
  f.calls[0].result.resolve(["settled citation"]); await Promise.resolve();
  expect(f.receive).toHaveBeenCalledWith(["settled citation"]);
  await vi.advanceTimersByTimeAsync(19_999); expect(f.read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.unavailable).not.toHaveBeenCalled();
});

it("does not turn duplicate visibility events into extra completed reads", async () => {
  const f = drive(); f.calls[0].result.resolve([]); await Promise.resolve();
  f.visibility.setHidden(false); f.visibility.setHidden(false);
  expect(f.read).toHaveBeenCalledOnce();
});

it("makes no initial or periodic read while hidden and refreshes on return", async () => {
  const f = drive(true); await vi.advanceTimersByTimeAsync(60_000);
  expect(f.read).not.toHaveBeenCalled(); expect(f.unavailable).not.toHaveBeenCalled();
  f.visibility.setHidden(false); expect(f.read).toHaveBeenCalledOnce();
});

it("does not overlap slow requests across interval ticks or redundant visible events", async () => {
  const f = drive(); await vi.advanceTimersByTimeAsync(60_000);
  f.visibility.setHidden(false); f.visibility.setHidden(false);
  expect(f.read).toHaveBeenCalledOnce();
  f.calls[0].result.resolve([]); await Promise.resolve(); expect(f.receive).toHaveBeenCalledWith([]);
  expect(f.read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(20_000); expect(f.read).toHaveBeenCalledTimes(2);
});

it.each(["resolve", "reject"] as const)("ignores a cancelled stale %s and starts one fresh visible read after it settles", async outcome => {
  const f = drive(); f.visibility.setHidden(true);
  expect(f.calls[0].signal.aborted).toBe(true);
  f.visibility.setHidden(false); f.visibility.setHidden(false);
  await vi.advanceTimersByTimeAsync(60_000); expect(f.read).toHaveBeenCalledOnce();
  if (outcome === "resolve") f.calls[0].result.resolve(["stale"]);
  else f.calls[0].result.reject(new Error("Cancelled read"));
  await Promise.resolve();
  expect(f.receive).not.toHaveBeenCalled(); expect(f.unavailable).not.toHaveBeenCalled();
  expect(f.read).toHaveBeenCalledTimes(2); expect(f.calls[1].signal.aborted).toBe(false);
  f.calls[1].result.resolve(["fresh"]); await Promise.resolve();
  expect(f.receive).toHaveBeenCalledExactlyOnceWith(["fresh"]);
});

it("drops a queued return refresh when the page becomes hidden again", async () => {
  const f = drive(); f.visibility.setHidden(true); f.visibility.setHidden(false); f.visibility.setHidden(true);
  f.calls[0].result.resolve(["stale"]); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(60_000); expect(f.read).toHaveBeenCalledOnce();
  expect(f.receive).not.toHaveBeenCalled(); expect(f.unavailable).not.toHaveBeenCalled();
  f.visibility.setHidden(false); expect(f.read).toHaveBeenCalledTimes(2);
});

it("reports a visible failure once without an immediate retry, and later accepts confirmed empty data", async () => {
  const f = drive(); f.calls[0].result.reject(new Error("Activity unavailable")); await Promise.resolve();
  expect(f.unavailable).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(20_000); f.calls[1].result.resolve([]); await Promise.resolve();
  expect(f.receive).toHaveBeenCalledExactlyOnceWith([]); expect(f.unavailable).toHaveBeenCalledOnce();
});

it.each(["resolve", "reject"] as const)("aborts/removes its lifecycle on cleanup and ignores late %s", async outcome => {
  const f = drive(); f.stop(); expect(f.calls[0].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  if (outcome === "resolve") f.calls[0].result.resolve(["late"]);
  else f.calls[0].result.reject(new Error("Late failure"));
  await Promise.resolve(); f.visibility.setHidden(true); f.visibility.setHidden(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.read).toHaveBeenCalledOnce(); expect(f.receive).not.toHaveBeenCalled(); expect(f.unavailable).not.toHaveBeenCalled();
});
