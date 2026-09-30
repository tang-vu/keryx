import { describe, expect, it } from "vitest";
import {
  assertPaymentSettlementState,
  paymentCountsAsSpent,
  paymentSettlementStatus,
  pendingAuthorizationStatusLabel,
} from "./payment-state";

describe("payment settlement state", () => {
  it('distinguishes possibly unsigned exposure from signed and submitted pending',()=>{
    expect(pendingAuthorizationStatusLabel({authorizationPhase:'exposed'})).toBe('reserved, possibly unsigned');
    expect(pendingAuthorizationStatusLabel({authorizationPhase:'signed'})).toBe('signed, pending proof');
    expect(pendingAuthorizationStatusLabel({authorizationPhase:'submission_attempted'})).toBe('submitted, pending proof');
    expect(pendingAuthorizationStatusLabel({})).toBe('pending proof');
  });
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
