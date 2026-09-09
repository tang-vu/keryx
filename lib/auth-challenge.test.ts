import { afterEach, expect, it, vi } from "vitest";
import { readSignInBody } from "./auth-challenge";

afterEach(() => vi.useRealTimers());

it("bounds a chunked request before parsing and cancels its stream", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(9000)); }, cancel() { cancelled = true; } });
  const request = new Request("https://example.test", { method: "POST", body, duplex: "half" } as RequestInit);
  await expect(readSignInBody(request)).rejects.toThrow("too large");
  expect(cancelled).toBe(true);
});

it("expires a stalled upload and releases the stream", async () => {
  vi.useFakeTimers(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request("https://example.test", { method: "POST", body, duplex: "half" } as RequestInit);
  const rejected = expect(readSignInBody(request)).rejects.toThrow("deadline");
  await vi.advanceTimersByTimeAsync(10000); await rejected;
  expect(cancelled).toBe(true);
});
