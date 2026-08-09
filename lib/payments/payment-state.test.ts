import { describe, expect, it } from "vitest";
import {
  assertPaymentSettlementState,
  paymentCountsAsSpent,
  paymentSettlementStatus,
} from "./payment-state";

describe("payment settlement state", () => {
  it("keeps failed receipts outside spend", () => {
    const payment = { settled: false, settlementStatus: "failed" as const };
    expect(paymentSettlementStatus(payment)).toBe("failed");
    expect(assertPaymentSettlementState(payment)).toBe("failed");
    expect(paymentCountsAsSpent(payment)).toBe(false);
  });

  it("counts settled and explicit offline simulations only", () => {
    expect(paymentCountsAsSpent({ settled: true, settlementStatus: "settled" })).toBe(true);
    expect(paymentCountsAsSpent({ settled: false, settlementStatus: "simulated" })).toBe(true);
    expect(paymentCountsAsSpent({ settled: false, settlementStatus: "pending" })).toBe(false);
  });
});
