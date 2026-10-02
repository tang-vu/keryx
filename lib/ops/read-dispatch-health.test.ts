import { describe, expect, it, vi } from "vitest";
import type { PaymentRecord, QueryRun } from "../types";
import { readDispatchHealth } from "./read-dispatch-health";

const now = new Date("2026-10-02T05:00:00Z");
const run = {
  id: "query", createdAt: now.toISOString(), engine: "llm:test", decisions: [],
  totalToCreators: 0, paymentMode: "real", paymentAttempts: 1, settledPayments: 0,
  pendingPayments: 1,
} as unknown as QueryRun;
const payment: PaymentRecord = {
  id: "payment", queryId: "query", kind: "fetch", sourceId: "source", sourceName: "Source",
  payer: "0x1111111111111111111111111111111111111111", payee: "0x2222222222222222222222222222222222222222",
  amountUsdc: 0.001, settled: false, settlementStatus: "pending", network: "eip155:5042002", createdAt: now.toISOString(),
};
const options = { now, expectReasoning: true };

describe("watchdog current creator ledger projection", () => {
  it("returns a judgeable idle summary even with no historical receipts", async () => {
    const db = { listCreatorPaymentAttemptsByQuery: vi.fn() };
    const summary = await readDispatchHealth(db, [], options);
    expect(summary.activity).toBe("idle");
    expect(summary.alarms).toEqual([]);
    expect(db.listCreatorPaymentAttemptsByQuery).not.toHaveBeenCalled();
    const expected = await readDispatchHealth(db, [], { ...options, expectDispatches: true });
    expect(expected.alarms.map(a => a.code)).toEqual(["silent"]);
  });

  it.each(["pending", "failed"] as const)("retains %s ledger legs without losing completed answers", async status => {
    const db = { listCreatorPaymentAttemptsByQuery: vi.fn(async () => [{ ...payment, settlementStatus: status }]) };
    const summary = await readDispatchHealth(db, [run], options);
    expect(summary.runs).toBe(1);
    expect(summary.alarms.map(a => a.code)).toEqual(["payment-unsettled"]);
  });

  it("clears an old pending counter once canonical reconciliation settles its leg", async () => {
    const db = { listCreatorPaymentAttemptsByQuery: vi.fn(async () => [{ ...payment, settled: true, settlementStatus: "settled" as const, txHash: "circle-settlement-id" }]) };
    const summary = await readDispatchHealth(db, [run], options);
    expect(summary.alarms).toEqual([]);
    expect(summary.paying).toBe(1);
    expect(summary.creatorPayoutUsdc).toBe(0.001);
  });

  it("keeps missing ledger evidence actionable and propagates read failures", async () => {
    expect((await readDispatchHealth({ listCreatorPaymentAttemptsByQuery: async () => [] }, [run], options)).alarms.map(a => a.code)).toEqual(["payment-unsettled"]);
    await expect(readDispatchHealth({ listCreatorPaymentAttemptsByQuery: async () => { throw new Error("database unavailable"); } }, [run], options)).rejects.toThrow("database unavailable");
  });
});
