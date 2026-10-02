import { afterEach, expect, it, vi } from "vitest";
import { createSessionGrantClock } from "./session-grant-time";
import { watchSessionGrantClock } from "./session-grant-liveness";
const owner = `0x${"1".repeat(40)}`, signer = `0x${"2".repeat(40)}`, utc = Date.parse("2026-10-01T00:00:00.000Z");
const body = { active: true, sessionId: owner, ownerAddr: owner, sessAddr: signer, grantEpoch: "original",
  expiresAt: new Date(utc + 60000).toISOString(), serverNow: new Date(utc).toISOString(), remainingMs: 60000, ttlMs: 60000 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", window); vi.stubGlobal("document", document);
  let now = 0, live = true;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const clock = createSessionGrantClock(body, { sessionId: owner, sessAddr: signer }, 0, 0, 60000);
  const expired = vi.fn(), unavailable = vi.fn(() => { live = false; });
  return { window, document, clock, expired, unavailable, setNow: (value: number) => { now = value; }, replace: () => { live = false; },
    watch: () => watchSessionGrantClock(clock, () => live, expired, unavailable) };
}
it("keeps a stable deadline across watcher rerenders and wall clock changes", async () => {
  const f = setup(); const stop = f.watch();
  f.setNow(20000); await vi.advanceTimersByTimeAsync(20000); stop();
  vi.spyOn(Date, "now").mockReturnValue(utc - 86400000);
  const again = f.watch(); f.setNow(60000); await vi.advanceTimersByTimeAsync(40000);
  expect(f.expired).toHaveBeenCalledTimes(1); expect(f.unavailable).not.toHaveBeenCalled(); again();
});
it("deduplicates focus/visibility reads, clamps only, and never posts a registration", async () => {
  const f = setup(); let resolve!: (value: Response) => void;
  const fetcher = vi.fn((_url, init) => {
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" });
    return new Promise<Response>(done => { resolve = done; });
  }); vi.stubGlobal("fetch", fetcher); const stop = f.watch();
  f.window.dispatchEvent(new Event("focus")); f.document.dispatchEvent(new Event("visibilitychange"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  f.setNow(100); resolve(Response.json({ ...body, serverNow: new Date(utc + 30000).toISOString(), remainingMs: 30000 }));
  await vi.advanceTimersByTimeAsync(0); expect(f.clock.remaining(100)).toBe(29900);
  fetcher.mockImplementationOnce(async () => Response.json(body));
  f.window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  expect(f.clock.remaining(100)).toBe(29900); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(f.unavailable).not.toHaveBeenCalled(); stop();
});
it("ignores a late read after the current registration was replaced", async () => {
  const f = setup(); let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; }))); const stop = f.watch();
  f.window.dispatchEvent(new Event("focus")); f.replace();
  resolve(Response.json({ active: false })); await vi.advanceTimersByTimeAsync(0);
  expect(f.unavailable).not.toHaveBeenCalled(); expect(f.clock.remaining(0)).toBe(60000); stop();
});
it.each([false, "owner", "signer", "epoch", "failure"])("pauses UI for inactive/mismatched/unavailable lookup %s", async failure => {
  const f = setup();
  const value = failure === false ? { active: false } : failure === "owner" ? { ...body, ownerAddr: signer }
    : failure === "signer" ? { ...body, sessAddr: owner } : failure === "epoch" ? { ...body, grantEpoch: "replacement" } : { error: "unavailable" };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(value, { status: failure === "failure" ? 503 : 200 })));
  const stop = f.watch(); f.window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  expect(f.unavailable).toHaveBeenCalledTimes(1); expect(f.expired).not.toHaveBeenCalled(); stop();
});
it("bounds an ignored transport cancellation and discards its late response", async () => {
  const f = setup(); let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; }))); const stop = f.watch();
  f.window.dispatchEvent(new Event("focus")); f.setNow(5000); await vi.advanceTimersByTimeAsync(5000);
  expect(f.unavailable).toHaveBeenCalledTimes(1);
  resolve(Response.json(body)); await vi.advanceTimersByTimeAsync(0);
  expect(f.unavailable).toHaveBeenCalledTimes(1); expect(f.clock.remaining(5000)).toBe(55000); stop();
});
it("rejects a completed response beyond the monotonic deadline before a delayed timer callback", async () => {
  const f = setup();
  vi.stubGlobal("fetch", vi.fn(async () => { f.setNow(5001); return Response.json(body); }));
  const stop = f.watch(); f.window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  expect(f.unavailable).toHaveBeenCalledTimes(1); expect(f.clock.remaining(5001)).toBe(54999); stop();
});
