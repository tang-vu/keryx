import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readCircleWalletAvailability, CIRCLE_WALLET_AVAILABILITY_TIMEOUT_MS } from "./circle-wallet-availability";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), milliseconds);
    return controller.signal;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function delayed(body: unknown, delay: number) {
  return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json(body)), delay);
    init.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
  }));
}

it("accepts the observed 13-second config response without a second request or any POST", async () => {
  const fetcher = delayed({ available: true }, 13_000); vi.stubGlobal("fetch", fetcher);
  const result = readCircleWalletAvailability();
  await vi.advanceTimersByTimeAsync(10_001);
  expect(fetcher.mock.calls[0][1].signal!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(2_999);
  expect(await result).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith("/api/auth/circle/config", expect.objectContaining({ cache: "no-store" }));
  expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  expect(AbortSignal.timeout).toHaveBeenCalledWith(30_000);
});

it("bounds a stalled request at 30 seconds without an automatic retry", async () => {
  const fetcher = delayed({ available: true }, 60_000); vi.stubGlobal("fetch", fetcher);
  const result = expect(readCircleWalletAvailability()).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(CIRCLE_WALLET_AVAILABILITY_TIMEOUT_MS);
  await result; expect(fetcher).toHaveBeenCalledTimes(1);
});

it("aborts an obsolete component check without waiting for the deadline", async () => {
  const fetcher = delayed({ available: true }, 60_000); vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  const result = expect(readCircleWalletAvailability(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await result;
  expect(fetcher.mock.calls[0][1].signal!.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("accepts only an explicit boolean false as disabled configuration", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: false })));
  expect(await readCircleWalletAvailability()).toBe(false);
});

it.each([{}, null, { available: "true" }, { available: 1 }])("refuses malformed readiness %j", async value => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(value)));
  await expect(readCircleWalletAvailability()).rejects.toThrow("availability could not be checked");
});

it("refuses HTTP errors and malformed JSON rather than treating them as disabled or ready", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ available: true }, { status: 503 }))
    .mockResolvedValueOnce(new Response("not-json"));
  vi.stubGlobal("fetch", fetcher);
  await expect(readCircleWalletAvailability()).rejects.toThrow("availability could not be checked");
  await expect(readCircleWalletAvailability()).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
