import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitSignature,
  cancelPending,
  resolveSignature,
} from "./pending-signatures";

describe("pending signatures", () => {
  afterEach(() => {
    cancelPending("session", "request");
    vi.useRealTimers();
  });

  it("rejects and removes the pending slot as soon as the SSE request aborts", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const pending = awaitSignature("session", "request", abort.signal);

    abort.abort();

    await expect(pending).rejects.toThrow("client disconnected");
    expect(resolveSignature("session", "request", "late-header")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not create a live slot for an already-aborted request", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    abort.abort();

    await expect(awaitSignature("session", "request", abort.signal)).rejects.toThrow(
      "client disconnected",
    );
    expect(resolveSignature("session", "request", "late-header")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
