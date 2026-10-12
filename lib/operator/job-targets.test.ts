import { describe, expect, it } from "vitest";
import { a2aResearchPackage } from "../a2a/research-package-definition";
import { paidJobEscalation } from "../a2a/overdue-status";
import type { A2aOrder } from "../a2a/order";
import type { PaymentRecord } from "../types";
import { jobCompletionTarget, jobTargetWarningDelay } from "./job-targets";

const accepted = Date.parse("2026-10-12T00:00:00Z");
const provider = `0x${"b".repeat(40)}`;
const original = {
  id: "a2a_original", queryId: "a2a_original", status: "running", researchMode: "quick",
  researchPackage: a2aResearchPackage("quick"), createdAt: new Date(accepted).toISOString(),
  updatedAt: new Date(accepted + 179_000).toISOString(), startedAt: new Date(accepted + 1000).toISOString(),
  paymentStartedAt: new Date(accepted + 2000).toISOString(), resultSavingAt: null, executionJournalVersion: 1,
  creatorBudgetUsdc: 0.05, payee: provider, request: { network: "eip155:5042002" },
} as A2aOrder;
const uncertain: PaymentRecord = {
  id: "original_leg", queryId: original.id, kind: "citation", amountUsdc: 0.01,
  payer: provider, network: "eip155:5042002", createdAt: new Date(accepted + 2500).toISOString(),
  sourceId: "synthetic_source", sourceName: "Synthetic source", payee: `0x${"c".repeat(40)}`,
  settled: false, settlementStatus: "pending",
  authorizationExpiresAt: new Date(accepted + 3000).toISOString(),
};

describe("original job completion targets", () => {
  it("reads supported tier/version terms without mutating the accepted registry", () => {
    expect(jobCompletionTarget("quick", "1.0.0")).toEqual({ tier: "quick", seconds: 180,
      startsAt: "accepted_at", kind: "provisional_slo", remedy: "none" });
    expect(jobCompletionTarget("deep", "1.0.0")?.seconds).toBe(300);
    expect(jobCompletionTarget("quick", "future")).toBeNull();
    expect(jobCompletionTarget("other" as "quick", "1.0.0")).toBeNull();
    expect(a2aResearchPackage("quick").serviceLevel.remedy).toBe("none");
  });

  it("crosses the original target while an expired leg stays uncertain, without mutation", () => {
    const before = JSON.stringify([original, uncertain]);
    const snapshot = paidJobEscalation(original, accepted + 179_000, [uncertain]);
    expect(snapshot).toMatchObject({ state: "within_target", creatorPaymentState: "pending_recorded" });
    expect(jobTargetWarningDelay(snapshot, 0)).toBe(1001);
    expect(jobTargetWarningDelay(snapshot, 1000)).toBe(1); // Exact target still counts as met.
    expect(jobTargetWarningDelay(snapshot, 1001)).toBe(0);
    expect(jobTargetWarningDelay(snapshot, 52 * 3_600_000)).toBe(0);
    expect(snapshot.state).toBe("within_target"); // Local warning never masquerades as a fresh read.
    const overdue = paidJobEscalation(original, accepted + 180_001, [uncertain]);
    expect(overdue).toMatchObject({ state: "overdue", creatorPaymentState: "pending_recorded", remedy: "none" });
    expect(JSON.stringify([original, uncertain])).toBe(before);
  });

  it("never uses later repair/update timestamps to restart the original clock", () => {
    const updated = { ...original, updatedAt: new Date(accepted + 179_900).toISOString() };
    const snapshot = paidJobEscalation(updated, accepted + 179_900, [uncertain]);
    expect(jobTargetWarningDelay(snapshot, 101)).toBe(0);
    expect(snapshot.targetCompletionAt).toBe(new Date(accepted + 180_000).toISOString());
  });

  it("refuses terminal, absent, inconsistent, unsupported or invalid clock snapshots", () => {
    const snapshot = paidJobEscalation(original, accepted + 179_000, [uncertain]);
    for (const bad of [undefined, { ...snapshot, state: "completed" as const },
      { ...snapshot, state: "unavailable" as const, escalationNeeded: null },
      { ...snapshot, targetCompletionMs: 1 }, { ...snapshot, elapsedMs: 1 },
      { ...snapshot, targetCompletionAt: snapshot.observedAt }, { ...snapshot, observedAt: "invalid" }]) {
      expect(jobTargetWarningDelay(bad, 1001)).toBeNull();
    }
    for (const elapsed of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(jobTargetWarningDelay(snapshot, elapsed)).toBeNull();
    }
  });
});
