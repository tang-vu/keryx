import { expect, it } from "vitest";
import { LlmCallLedger } from "./call-ledger";

it("keeps overlapping calls correlated and exposes pending work without leaking errors", async () => {
  const ledger = new LlmCallLedger();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let firstId: string | undefined;
  const first = ledger.track("synthetic", async () => {
    firstId = ledger.currentId;
    await gate;
    expect(ledger.currentId).toBe(firstId);
  });
  await expect(ledger.track("synthetic", async () => {
    expect(ledger.currentId).not.toBe(firstId);
    throw new Error("private body");
  })).rejects.toThrow("private body");
  expect(ledger.currentId).toBeUndefined();
  expect(ledger.calls.map((call) => call.outcome)).toEqual(["pending", "failed"]);
  const snapshot = ledger.calls;
  snapshot[0].outcome = "failed";
  expect(ledger.calls[0].outcome).toBe("pending");
  release();
  await first;
  expect(ledger.calls.map((call) => call.outcome)).toEqual(["returned", "failed"]);
  expect(JSON.stringify(ledger.calls)).not.toContain("private body");
});
