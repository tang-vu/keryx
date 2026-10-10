import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { maintenanceStatus } from "./planned-window";
import { observeMaintenanceStatus, STATUS_BYTES_LIMIT, STATUS_INTERVAL_MS, STATUS_LIFETIME_MS, STATUS_READ_LIMIT,
  STATUS_TIMEOUT_MS, type StatusObservation, type StatusReadBudget } from "./status-observer";

const current = maintenanceStatus({ kind: "absent" }, 0);
const initial = (): StatusReadBudget => ({ startedAt: null, reads: 0, stopped: false });
const response = () => Response.json(current);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(0);

it("uses only fixed unauthenticated GETs, with a finite lifetime and budget across effect restarts", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response()), seen: StatusObservation[] = [], budget = initial();
  const options = { fetcher, visible: () => true, now: Date.now };
  let close = observeMaintenanceStatus(budget, value => seen.push(value), options);
  await tick(); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual(["/maintenance/status", expect.objectContaining({ method: "GET", credentials: "omit",
    redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) })]);
  const startedAt = budget.startedAt;
  await vi.advanceTimersByTimeAsync(STATUS_INTERVAL_MS * 3);
  close(); close = observeMaintenanceStatus(budget, value => seen.push(value), options); await tick();
  expect(budget.startedAt).toBe(startedAt);
  await vi.advanceTimersByTimeAsync(STATUS_LIFETIME_MS);
  expect(budget.stopped).toBe(true); expect(budget.reads).toBeLessThanOrEqual(STATUS_READ_LIMIT);
  expect(seen.at(-1)).toEqual({ kind: "finished" });
  const calls = fetcher.mock.calls.length; close();
  close = observeMaintenanceStatus(budget, value => seen.push(value), options);
  await vi.advanceTimersByTimeAsync(STATUS_LIFETIME_MS); expect(fetcher).toHaveBeenCalledTimes(calls); close();
});

it("does not reset or extend its lifetime when the page is hidden then visible", async () => {
  let visible = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response()), budget = initial(), seen: StatusObservation[] = [];
  const close = observeMaintenanceStatus(budget, value => seen.push(value), { fetcher, visible: () => visible, now: Date.now });
  await vi.advanceTimersByTimeAsync(STATUS_LIFETIME_MS - STATUS_INTERVAL_MS); expect(fetcher).not.toHaveBeenCalled();
  visible = true; await vi.advanceTimersByTimeAsync(STATUS_LIFETIME_MS);
  expect(budget.stopped).toBe(true); expect(fetcher.mock.calls.length).toBeLessThanOrEqual(1);
  expect(seen.at(-1)).toEqual({ kind: "finished" }); close();
});

it("stops on404, malformed/incoherent bodies, oversized streams, redirects and network failure without retry", async () => {
  const bad = [() => new Response("Not found", { status: 404 }), () => Response.json({ state: ["normal"] }),
    () => Response.json({ ...current, applicationStatus: "healthy" }),
    () => new Response("x".repeat(STATUS_BYTES_LIMIT + 1), { headers: { "content-type": "application/json" } }),
    () => Object.defineProperty(response(), "redirected", { value: true }),
    () => { throw Error("Synthetic offline failure"); }];
  for (const fixture of bad) {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => fixture()), seen: StatusObservation[] = [], budget = initial();
    const close = observeMaintenanceStatus(budget, value => seen.push(value), { fetcher, visible: () => true, now: Date.now });
    await tick(); await vi.advanceTimersByTimeAsync(STATUS_LIFETIME_MS);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(seen).toEqual([{ kind: "unavailable" }]); expect(budget.stopped).toBe(true); close();
  }
});

it("bounds a stalled read and aborts an in-flight read on cleanup without changing caller state", async () => {
  const signals: AbortSignal[] = [], fetcher = vi.fn<typeof fetch>().mockImplementation((_path, init) => {
    signals.push(init!.signal!); return new Promise(() => {});
  }), seen: StatusObservation[] = [];
  let close = observeMaintenanceStatus(initial(), value => seen.push(value), { fetcher, visible: () => true, now: Date.now });
  await tick(); await vi.advanceTimersByTimeAsync(STATUS_TIMEOUT_MS);
  expect(signals[0].aborted).toBe(true); expect(seen).toEqual([{ kind: "unavailable" }]); close();
  seen.length = 0;
  close = observeMaintenanceStatus(initial(), value => seen.push(value), { fetcher, visible: () => true, now: Date.now });
  await tick(); close(); await vi.advanceTimersByTimeAsync(STATUS_LIFETIME_MS);
  expect(signals[1].aborted).toBe(true); expect(seen).toEqual([]);
});
