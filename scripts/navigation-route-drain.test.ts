import { afterEach, expect, it, vi } from "vitest";
import { createNavigationRouteDrain } from "../test-support/navigation-route-drain";

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const route = () => ({ abort: vi.fn(async (_code?: string) => undefined) });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

it("closes a settled context without removing its interceptor", async () => {
  const drain = createNavigationRouteDrain(), context = { close: vi.fn(async () => undefined), unrouteAll: vi.fn() };
  const forwarded = vi.fn(async () => undefined);
  await drain.handle(route(), forwarded); await drain.closeContext(context);
  expect(forwarded).toHaveBeenCalledOnce(); expect(context.close).toHaveBeenCalledOnce();
  expect(context.unrouteAll).not.toHaveBeenCalled();
});

it("waits for both held aborts and in-flight proxies before closing", async () => {
  const drain = createNavigationRouteDrain(), abort = deferred(), proxy = deferred();
  const held = { abort: vi.fn(() => abort.promise) }, context = { close: vi.fn(async () => undefined) };
  drain.held.add(held);
  const forwarding = drain.handle(route(), () => proxy.promise); await tick();
  const closing = drain.closeContext(context); await tick();
  expect(held.abort).toHaveBeenCalledWith("aborted"); expect(context.close).not.toHaveBeenCalled();
  abort.resolve(); await tick(); expect(context.close).not.toHaveBeenCalled();
  proxy.resolve(); await forwarding; await closing;
  expect(context.close).toHaveBeenCalledOnce(); expect(drain.held.size).toBe(0);
});

it("aborts new arrivals behind the same fence while a proxy is draining", async () => {
  const drain = createNavigationRouteDrain(), proxy = deferred(), context = { close: vi.fn(async () => undefined) };
  const forwarding = drain.handle(route(), () => proxy.promise); await tick();
  const closing = drain.closeContext(context), late = route(), forbiddenForward = vi.fn(async () => undefined);
  await drain.handle(late, forbiddenForward);
  expect(late.abort).toHaveBeenCalledWith("aborted"); expect(forbiddenForward).not.toHaveBeenCalled();
  expect(context.close).not.toHaveBeenCalled(); proxy.resolve(); await forwarding; await closing;
});

it("retains a handler failure that finished before cleanup and still closes", async () => {
  const drain = createNavigationRouteDrain(), failure = new Error("proxy failed"), context = { close: vi.fn(async () => undefined) };
  await expect(drain.handle(route(), async () => { throw failure; })).rejects.toBe(failure);
  const error = await drain.closeContext(context).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([failure]);
  expect(context.close).toHaveBeenCalledOnce();
});

it("retains failed held disposal without skipping remaining proxy settlement", async () => {
  const drain = createNavigationRouteDrain(), failure = new Error("abort failed"), proxy = deferred();
  drain.held.add({ abort: async () => { throw failure; } });
  const forwarding = drain.handle(route(), () => proxy.promise), context = { close: vi.fn(async () => undefined) }; await tick();
  const closing = drain.closeContext(context).catch(error => error); await tick();
  expect(context.close).not.toHaveBeenCalled(); proxy.resolve(); await forwarding;
  expect((await closing).errors).toEqual([failure]); expect(context.close).toHaveBeenCalledOnce();
});

it("fails a stalled drain within its bound and attempts context disposal", async () => {
  vi.useFakeTimers(); const drain = createNavigationRouteDrain(), proxy = deferred();
  const forwarding = drain.handle(route(), () => proxy.promise), context = { close: vi.fn(async () => proxy.resolve()) }; await tick();
  const closing = drain.closeContext(context, 100).catch(error => error); await vi.advanceTimersByTimeAsync(100);
  const error = await closing; expect(error.errors.map((e: Error) => e.message)).toEqual(["Navigation route drain exceeded 100ms"]);
  await forwarding; expect(context.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("retains disposal failure after successful drain", async () => {
  const drain = createNavigationRouteDrain(), failure = new Error("close failed");
  const error = await drain.closeContext({ close: async () => { throw failure; } }).catch(error => error);
  expect(error.errors).toEqual([failure]);
});

it("still releases other held routes when one abort throws synchronously", async () => {
  const drain = createNavigationRouteDrain(), failure = new Error("sync abort failed"), other = route();
  drain.held.add({ abort: () => { throw failure; } }); drain.held.add(other);
  const error = await drain.closeContext({ close: async () => undefined }).catch(error => error);
  expect(other.abort).toHaveBeenCalledWith("aborted"); expect(error.errors).toEqual([failure]);
});

it("fails a stalled context close and clears its deadline timer", async () => {
  vi.useFakeTimers(); const drain = createNavigationRouteDrain(), close = deferred();
  const closing = drain.closeContext({ close: () => close.promise }, 100).catch(error => error);
  await vi.advanceTimersByTimeAsync(100);
  expect((await closing).errors.map((e: Error) => e.message)).toEqual(["Navigation context close exceeded 100ms"]);
  close.resolve(); await tick(); expect(vi.getTimerCount()).toBe(0);
});
