import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitSignature,
  cancelPending,
  resolveSignature,
} from "./pending-signatures";

const challenge = {
  expectedSigner: `0x${"11".repeat(20)}`,
  requirements: {
    scheme: "exact", network: "eip155:5042002",
    asset: `0x${"22".repeat(20)}`, amount: "2000", payTo: `0x${"33".repeat(20)}`,
    maxTimeoutSeconds: 691200,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: `0x${"44".repeat(20)}` },
  },
};

describe("pending signatures", () => {
  afterEach(() => {
    cancelPending("session", "request");
    vi.useRealTimers();
  });

  it("rejects and removes the pending slot as soon as the SSE request aborts", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const pending = awaitSignature("session", "request", challenge, abort.signal);

    abort.abort();

    await expect(pending).rejects.toThrow("client disconnected");
    expect(resolveSignature("session", "request", "late-header")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not create a live slot for an already-aborted request", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    abort.abort();

    await expect(awaitSignature("session", "request", challenge, abort.signal)).rejects.toThrow(
      "client disconnected",
    );
    expect(resolveSignature("session", "request", "late-header")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
