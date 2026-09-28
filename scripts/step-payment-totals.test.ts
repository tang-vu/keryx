import { describe, expect, it } from "vitest";
import type { PaymentRecord, TraceStep } from "@/lib/types";
import { spentFromSteps, stepPaymentTotals } from "@/components/keryx/budget-meter";

const base: PaymentRecord = {
  kind: "citation", queryId: "run-1", sourceId: "source-1", sourceName: "Source",
  payer: "payer", payee: "author", amountUsdc: 0.001, network: "eip155:5042002",
  settled: false, createdAt: "2026-09-28T00:00:00Z",
};

function step(phase: TraceStep["phase"], detail: unknown): TraceStep {
  return { phase, detail, message: "fixture", ts: 1 };
}

describe("live payment totals", () => {
  it("keeps real settlement, pending authorization, offline simulation, and failure separate", () => {
    const steps: TraceStep[] = [
      step("fetch", { ...base, kind: "fetch", settled: true, settlementStatus: "settled", amountUsdc: 0.002 }),
      step("settle", { ...base, settlementStatus: "pending", amountUsdc: 0.003 }),
      step("settle", { ...base, settlementStatus: "simulated", amountUsdc: 0.004 }),
      step("fetch", { ...base, settlementStatus: "failed", amountUsdc: 0.005 }),
      step("settle", { ...base, settlementStatus: "settled", amountUsdc: 0.006 }),
      step("settle", { ...base, settled: true, settlementStatus: "pending", amountUsdc: 0.007 }),
      step("settle", { amountUsdc: 0.5 }),
      step("decide", { ...base, settled: true, settlementStatus: "settled", amountUsdc: 0.8 }),
    ];
    const totals = stepPaymentTotals(steps);
    expect(totals.settled).toBe(0.002);
    expect(totals.pending).toBe(0.003);
    expect(totals.simulated).toBe(0.004);
    expect(totals.failed).toBe(0.005);
    expect(totals.unverified).toBeCloseTo(0.013);
    expect(spentFromSteps(steps)).toBe(0.002);
  });
});
