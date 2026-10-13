import { describe, expect, it } from "vitest";
import { a2aResearchPackage } from "../a2a/research-package-definition";
import { paidJobEscalation } from "../a2a/overdue-status";
import type { A2aOrder } from "../a2a/order";
import type { PaymentRecord } from "../types";
import { jobAlertDeliveryObservation, jobCompletionMetrics, jobCompletionTarget, jobTargetCustomerState, jobTargetWarningDelay } from "./job-targets";
import { summarizeA2aOperations } from "../a2a/operations";
import { COMPLETION_FIXTURE_NOW, completionFixtureRows, ordinaryCompletion } from "../a2a/completion-latency.test-support";

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

describe("original completion metric adapter", () => {
  const M = Number.MAX_SAFE_INTEGER;
  const emptyCohort = { completed: 0, timedSamples: 0, p50Ms: null, p95Ms: null };

  it("keeps ordinary, 52-hour repaired, original fulfillment and unknown counts separate", () => {
    const input = summarizeA2aOperations(completionFixtureRows(), COMPLETION_FIXTURE_NOW, true);
    const before = JSON.stringify(input);
    const result = jobCompletionMetrics(input);
    expect(result.recordedCompletion).toEqual({
      basis: "original_acceptance_to_recorded_completion_update", window: "recorded_completion_update_in_last_24_hours",
      completed: 6, cohorts: {
        ordinary: { completed: 2, timedSamples: 2, p50Ms: 1000, p95Ms: 3000 },
        recovered: { completed: 2, timedSamples: 2, p50Ms: 5000, p95Ms: 52 * 60 * 60_000 },
        unknown: { completed: 2, timedSamples: 1, p50Ms: 2000, p95Ms: 2000 },
      },
    });
    expect(result.paymentToDeliveredOutput).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
    expect(result.firstUserFirstAnswer).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/synthetic-timing-only|question|paymentReference/);
  });

  it("retains later bookkeeping in the named legacy basis without relabeling it as delivery", () => {
    const row = ordinaryCompletion(1000);
    row.updatedAt = new Date(COMPLETION_FIXTURE_NOW + 10_000).toISOString();
    const input = summarizeA2aOperations([row], COMPLETION_FIXTURE_NOW + 10_000, true);
    expect(jobCompletionMetrics(input).recordedCompletion.cohorts?.ordinary.p50Ms).toBe(11_000);
    expect(jobCompletionMetrics({ ...input, settledAt: row.createdAt, deliveredAt: row.updatedAt,
      transaction: "synthetic-ref", timeToFirstAnswerMs: 0 }).paymentToDeliveredOutput.timedSamples).toBeNull();
  });

  it("retains measured zeros from the actual empty producer snapshot with marker capability", () => {
    const input = summarizeA2aOperations([], COMPLETION_FIXTURE_NOW, true);
    const before = structuredClone(input), bytes = JSON.stringify(input);
    const empty = jobCompletionMetrics(input);
    expect(empty.recordedCompletion).toEqual({
      basis: "original_acceptance_to_recorded_completion_update", window: "recorded_completion_update_in_last_24_hours",
      completed: 0, cohorts: {
        ordinary: { completed: 0, timedSamples: 0, p50Ms: null, p95Ms: null },
        recovered: { completed: 0, timedSamples: 0, p50Ms: null, p95Ms: null },
        unknown: { completed: 0, timedSamples: 0, p50Ms: null, p95Ms: null },
      },
    });
    expect(empty.paymentToDeliveredOutput.timedSamples).toBeNull();
    expect(empty.firstUserFirstAnswer.timedSamples).toBeNull();
    expect(input).toEqual(before);
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it("makes this recorded metric unavailable for legacy aggregate six with null cohorts without changing the producer", () => {
    const input = summarizeA2aOperations(completionFixtureRows(), COMPLETION_FIXTURE_NOW);
    expect(input).toMatchObject({ completedLast24h: 6, completionLatencyCohorts: null });
    const before = JSON.stringify(input);
    expect(jobCompletionMetrics(input).recordedCompletion).toMatchObject({ completed: null, cohorts: null });
    expect(JSON.stringify(input)).toBe(before);
    // A legacy zero also lacks cohort capability; it is not a measured empty cohort.
    const zero = summarizeA2aOperations([], COMPLETION_FIXTURE_NOW), zeroBefore = structuredClone(zero), zeroBytes = JSON.stringify(zero);
    expect(zero).toMatchObject({ completedLast24h: 0, completionLatencyCohorts: null });
    expect(jobCompletionMetrics(zero).recordedCompletion)
      .toMatchObject({ completed: null, cohorts: null });
    expect(zero).toEqual(zeroBefore);
    expect(JSON.stringify(zero)).toBe(zeroBytes);
  });

  it("keeps missing snapshots and missing cohort capability unavailable", () => {
    for (const missing of [null, undefined, {}, { completedLast24h: 0 }]) {
      expect(jobCompletionMetrics(missing).recordedCompletion).toMatchObject({ completed: null, cohorts: null });
    }
  });

  it("refuses malformed aggregate and cohort capability packets", () => {
    const input = summarizeA2aOperations(completionFixtureRows(), COMPLETION_FIXTURE_NOW, true);
    for (const malformed of [
      { ...input, completedLast24h: "6" }, { ...input, completedLast24h: 0.5 },
      { ...input, completedLast24h: NaN }, { ...input, completedLast24h: Infinity },
      { ...input, completionLatencyCohorts: "unavailable" },
      { ...input, completionLatencyCohorts: { ordinary: null, recovered: null, unknown: null } },
    ]) expect(jobCompletionMetrics(malformed).recordedCompletion).toMatchObject({ completed: null, cohorts: null });
  });

  it("refuses partial, conflicting, unsafe and fabricated percentile/count packets", () => {
    const input = summarizeA2aOperations(completionFixtureRows(), COMPLETION_FIXTURE_NOW, true);
    const cohorts = input.completionLatencyCohorts!;
    for (const invalid of [
      { ...input, completedLast24h: 7 },
      { ...input, completionLatencyCohorts: { ordinary: cohorts.ordinary } },
      ...[{ timedSamples: 3 }, { timedSamples: -1 }, { p50Ms: NaN }, { p95Ms: 999 },
        { completed: Number.MAX_SAFE_INTEGER + 1 }, { timedSamples: 0 }, { p50Ms: null }]
        .map(delta => ({ ...input, completionLatencyCohorts: { ...cohorts, ordinary: { ...cohorts.ordinary, ...delta } } })),
    ]) expect(jobCompletionMetrics(invalid).recordedCompletion).toMatchObject({ completed: null, cohorts: null });
  });

  // Synthetic shape endpoints only, not backend samples or percentile provenance.
  it.each([
    { name: "safe maximum total, sample count and durations", completedLast24h: M, completionLatencyCohorts: {
      ordinary: { completed: M, timedSamples: M, p50Ms: M, p95Ms: M },
      recovered: { ...emptyCohort }, unknown: { ...emptyCohort },
    } },
    { name: "safe maximum split total with a measured zero duration", completedLast24h: M, completionLatencyCohorts: {
      ordinary: { completed: M - 2, timedSamples: 0, p50Ms: null, p95Ms: null },
      recovered: { completed: 1, timedSamples: 1, p50Ms: 0, p95Ms: 0 }, unknown: { ...emptyCohort, completed: 1 },
    } },
  ])("accepts $name without inventing delivery endpoints", ({ name, ...input }) => {
    const before = structuredClone(input), bytes = JSON.stringify(input);
    const result = jobCompletionMetrics(input);
    expect(result.recordedCompletion).toEqual({
      basis: "original_acceptance_to_recorded_completion_update", window: "recorded_completion_update_in_last_24_hours",
      completed: M, cohorts: input.completionLatencyCohorts,
    });
    expect(result.paymentToDeliveredOutput).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
    expect(result.firstUserFirstAnswer).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
    expect(input, name).toEqual(before);
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it("refuses individually safe cohort counts whose exclusive sum is M+1", () => {
    const input = { completedLast24h: M, completionLatencyCohorts: {
      ordinary: { ...emptyCohort, completed: M }, recovered: { ...emptyCohort, completed: 1 }, unknown: { ...emptyCohort },
    } };
    const before = structuredClone(input), bytes = JSON.stringify(input);
    const result = jobCompletionMetrics(input);
    expect(result.recordedCompletion).toMatchObject({ completed: null, cohorts: null });
    expect(result.paymentToDeliveredOutput).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
    expect(result.firstUserFirstAnswer).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
    expect(input).toEqual(before);
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it.each([M + 1, NaN, Infinity, -Infinity, -1, 0.5])("refuses every unsafe completion count/duration %s without mutating it", invalid => {
    const input = { completedLast24h: M, completionLatencyCohorts: {
      ordinary: { completed: M, timedSamples: M, p50Ms: M, p95Ms: M },
      recovered: { ...emptyCohort }, unknown: { ...emptyCohort },
    } };
    const packets = [ { ...input, completedLast24h: invalid } ];
    for (const cohort of ["ordinary", "recovered", "unknown"] as const) {
      for (const field of ["completed", "timedSamples", "p50Ms", "p95Ms"] as const) {
        packets.push({ ...input, completionLatencyCohorts: { ...input.completionLatencyCohorts,
          [cohort]: { ...input.completionLatencyCohorts[cohort], [field]: invalid },
        } });
      }
    }
    for (const packet of packets) {
      // JSON alone would disguise NaN/Infinity as null; retain numeric identity too.
      const before = structuredClone(packet), bytes = JSON.stringify(packet);
      const result = jobCompletionMetrics(packet);
      expect(result.recordedCompletion).toMatchObject({ completed: null, cohorts: null });
      expect(result.paymentToDeliveredOutput).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
      expect(result.firstUserFirstAnswer).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
      expect(packet).toEqual(before);
      expect(JSON.stringify(packet)).toBe(bytes);
    }
  });

  it.each([
    { name: "samples exceed completions", completed: 1, timedSamples: 2, p50Ms: 0, p95Ms: 0 },
    { name: "zero samples with two numeric percentiles", completed: 0, timedSamples: 0, p50Ms: 0, p95Ms: 0 },
    { name: "zero samples with one numeric percentile", completed: 1, timedSamples: 0, p50Ms: null, p95Ms: 0 },
    { name: "nonzero samples missing p50", completed: 1, timedSamples: 1, p50Ms: null, p95Ms: 0 },
    { name: "nonzero samples missing p95", completed: 1, timedSamples: 1, p50Ms: 0, p95Ms: null },
    { name: "reversed percentiles", completed: 1, timedSamples: 1, p50Ms: 1, p95Ms: 0 },
  ])("refuses $name in each cohort", ({ name, ...summary }) => {
    for (const cohort of ["ordinary", "recovered", "unknown"] as const) {
      const input = { completedLast24h: summary.completed, completionLatencyCohorts: {
        ordinary: { ...emptyCohort }, recovered: { ...emptyCohort }, unknown: { ...emptyCohort }, [cohort]: summary,
      } };
      const before = structuredClone(input), bytes = JSON.stringify(input);
      expect(jobCompletionMetrics(input).recordedCompletion, name).toMatchObject({ completed: null, cohorts: null });
      expect(input).toEqual(before);
      expect(JSON.stringify(input)).toBe(bytes);
    }
  });

  it("requires all three exact cohort keys and all four exact summary fields", () => {
    const cohorts = { ordinary: { ...emptyCohort }, recovered: { ...emptyCohort }, unknown: { ...emptyCohort } };
    const input = { completedLast24h: 0, completionLatencyCohorts: cohorts };
    expect(jobCompletionMetrics(input).recordedCompletion).toMatchObject({ completed: 0, cohorts });
    const invalid: unknown[] = [{ ...input, completionLatencyCohorts: { ...cohorts, extra: { ...emptyCohort } } }];
    for (const cohort of ["ordinary", "recovered", "unknown"] as const) {
      const missingCohort: Record<string, unknown> = { ...cohorts };
      delete missingCohort[cohort];
      invalid.push({ ...input, completionLatencyCohorts: missingCohort });
      invalid.push({ ...input, completionLatencyCohorts: { ...cohorts, [cohort]: { ...emptyCohort, extra: 0 } } });
      for (const field of ["completed", "timedSamples", "p50Ms", "p95Ms"] as const) {
        const missingField: Record<string, unknown> = { ...emptyCohort };
        delete missingField[field];
        invalid.push({ ...input, completionLatencyCohorts: { ...cohorts, [cohort]: missingField } });
      }
    }
    for (const packet of invalid) {
      const before = structuredClone(packet), bytes = JSON.stringify(packet);
      expect(jobCompletionMetrics(packet).recordedCompletion).toMatchObject({ completed: null, cohorts: null });
      expect(packet).toEqual(before);
      expect(JSON.stringify(packet)).toBe(bytes);
    }
  });

  it("preserves a legacy M/null producer total while withholding cohort-qualified metrics", () => {
    const input = { ...summarizeA2aOperations([], COMPLETION_FIXTURE_NOW), completedLast24h: M };
    const before = structuredClone(input), bytes = JSON.stringify(input);
    expect(input.completionLatencyCohorts).toBeNull();
    const result = jobCompletionMetrics(input);
    expect(result.recordedCompletion).toMatchObject({ completed: null, cohorts: null });
    expect(result.paymentToDeliveredOutput).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
    expect(result.firstUserFirstAnswer).toMatchObject({ timedSamples: null, p50Ms: null, p95Ms: null });
    expect(input).toEqual(before);
    expect(JSON.stringify(input)).toBe(bytes);
    expect(input.completedLast24h).toBe(M);
  });
});

describe("customer and alert observation adapters", () => {
  const M = Number.MAX_SAFE_INTEGER;
  it("keeps stale, exact-target, observed-overdue and completed states distinct with an uncertain original leg", () => {
    const before = JSON.stringify([original, uncertain]);
    const within = paidJobEscalation(original, accepted + 180_000, [uncertain]);
    expect(jobTargetCustomerState(within)).toBe("within_target_on_observation");
    expect(jobTargetCustomerState(within, true)).toBe("target_elapsed_since_observation");
    expect(jobTargetCustomerState(paidJobEscalation(original, accepted + 180_001, [uncertain]))).toBe("overdue_on_observation");
    expect(jobTargetCustomerState(paidJobEscalation({ ...original, status: "completed" }, accepted + 180_001), true)).toBe("completed_on_observation");
    expect(jobTargetCustomerState({ ...within, state: "overdue", escalationNeeded: true })).toBe("unavailable");
    expect(jobTargetCustomerState({ ...within, elapsedMs: 1 })).toBe("unavailable");
    expect(jobTargetCustomerState(undefined)).toBe("not_observed");
    expect(JSON.stringify([original, uncertain])).toBe(before);
    expect(within.creatorPaymentState).toBe("pending_recorded");
  });

  it("never promotes aggregate transport acknowledgment into responder/customer receipt or cadence proof", () => {
    const known = { status: "observed", coverage: "complete", overdue: 1, acknowledged: 1, suppressed: 0, unknown: 0, deferred: 0 };
    expect(jobAlertDeliveryObservation(known)).toEqual({ status: "observed", coverage: "complete", overdue: 1,
      transportAcknowledged: 1, suppressed: 0, transportUnknown: 0, deferred: 0,
      responderReceived: null, customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized" });
    const ambiguous = { ...known, acknowledged: 0, suppressed: 1, unknown: 1 };
    expect(jobAlertDeliveryObservation(ambiguous)).toMatchObject({ transportAcknowledged: 0, transportUnknown: 1,
      suppressed: 1, customerStateDelivered: null, automaticResend: "not_authorized" });
    expect(jobAlertDeliveryObservation({ ...known, coverage: "partial", acknowledged: 0, deferred: 1 }))
      .toMatchObject({ coverage: "partial", deferred: 1, targetWindowMet: null });
  });

  // Source-derived from paid-job-alert-observer: retained reservations suppress
  // and may be unknown; deferred originals never have a transport outcome;
  // each new attempt contributes exactly one acknowledgment or unknown outcome.
  it.each([
    { name: "missing new attempt outcome", coverage: "complete", overdue: 1, acknowledged: 0, suppressed: 0, unknown: 0, deferred: 0 },
    { name: "one original double counted as deferred and unknown", coverage: "partial", overdue: 1, acknowledged: 0, suppressed: 0, unknown: 1, deferred: 1 },
    { name: "unknown below the two new unknown attempts", coverage: "partial", overdue: 6, acknowledged: 1, suppressed: 2, unknown: 1, deferred: 1 },
    { name: "unknown above new attempts plus suppressed reservations", coverage: "partial", overdue: 6, acknowledged: 1, suppressed: 2, unknown: 5, deferred: 1 },
    { name: "negative remainder after exclusive branches", coverage: "partial", overdue: 2, acknowledged: 1, suppressed: 1, unknown: 0, deferred: 1 },
    { name: "deferred original presented as complete coverage", coverage: "complete", overdue: 1, acknowledged: 0, suppressed: 0, unknown: 0, deferred: 1 },
  ])("refuses producer-impossible accounting: $name", ({ name, ...packet }) => {
    expect(jobAlertDeliveryObservation({ status: "observed", ...packet }), name).toEqual({
      status: "unavailable", coverage: "not-observed", overdue: null, transportAcknowledged: null,
      suppressed: null, transportUnknown: null, deferred: null, responderReceived: null,
      customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
    });
  });

  it.each([2, 3, 4])("accepts suppression/unknown overlap at unknown=%i within both producer bounds", unknown => {
    // Six originals: one ACK, two retained reservations, one deferred, two new
    // unknown attempts. Zero, one or both reservations may also be unknown.
    const packet = { status: "observed", coverage: "partial", overdue: 6, acknowledged: 1, suppressed: 2, unknown, deferred: 1 };
    const before = JSON.stringify(packet);
    expect(jobAlertDeliveryObservation(packet)).toEqual({
      status: "observed", coverage: "partial", overdue: 6, transportAcknowledged: 1,
      suppressed: 2, transportUnknown: unknown, deferred: 1, responderReceived: null,
      customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
    });
    expect(JSON.stringify(packet)).toBe(before);
  });

  it("keeps new unknown attempts distinct from deferred originals and accepts incomplete scan coverage", () => {
    expect(jobAlertDeliveryObservation({ status: "observed", coverage: "complete", overdue: 1,
      acknowledged: 0, suppressed: 0, unknown: 1, deferred: 0 }))
      .toMatchObject({ status: "observed", coverage: "complete", transportUnknown: 1, deferred: 0 });
    expect(jobAlertDeliveryObservation({ status: "observed", coverage: "partial", overdue: 2,
      acknowledged: 0, suppressed: 0, unknown: 1, deferred: 1 }))
      .toMatchObject({ status: "observed", coverage: "partial", transportUnknown: 1, deferred: 1 });
    // Truncation/unreadable/timing-unavailable rows may leave no overdue entries.
    for (const coverage of ["complete", "partial"]) {
      expect(jobAlertDeliveryObservation({ status: "observed", coverage, overdue: 0,
        acknowledged: 0, suppressed: 0, unknown: 0, deferred: 0 })).toEqual({
        status: "observed", coverage, overdue: 0, transportAcknowledged: 0,
        suppressed: 0, transportUnknown: 0, deferred: 0, responderReceived: null,
        customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
      });
    }
  });

  // Successive subtraction gives R=O-A-S-D; only S may overlap unknown.
  // These synthetic M endpoints check shape/arithmetic, not observer caps or receipt.
  it.each([
    { name: "all acknowledged, R=0", coverage: "complete", overdue: M, acknowledged: M, suppressed: 0, unknown: 0, deferred: 0 },
    { name: "all new unknown, R=M", coverage: "complete", overdue: M, acknowledged: 0, suppressed: 0, unknown: M, deferred: 0 },
    { name: "all suppressed at lower bound", coverage: "complete", overdue: M, acknowledged: 0, suppressed: M, unknown: 0, deferred: 0 },
    { name: "all suppressed at upper bound", coverage: "complete", overdue: M, acknowledged: 0, suppressed: M, unknown: M, deferred: 0 },
    { name: "mixed lower bound, R=M-4", coverage: "partial", overdue: M, acknowledged: 1, suppressed: 2, unknown: M - 4, deferred: 1 },
    { name: "mixed upper bound, R+S=M-2", coverage: "partial", overdue: M, acknowledged: 1, suppressed: 2, unknown: M - 2, deferred: 1 },
    { name: "all deferred with partial coverage", coverage: "partial", overdue: M, acknowledged: 0, suppressed: 0, unknown: 0, deferred: M },
  ])("accepts safe maximum accounting: $name", ({ name, ...packet }) => {
    const input = { status: "observed", ...packet };
    const before = structuredClone(input), bytes = JSON.stringify(input);
    expect(jobAlertDeliveryObservation(input), name).toEqual({
      status: "observed", coverage: packet.coverage, overdue: M, transportAcknowledged: packet.acknowledged,
      suppressed: packet.suppressed, transportUnknown: packet.unknown, deferred: packet.deferred,
      responderReceived: null, customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
    });
    expect(input).toEqual(before);
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it.each([
    { name: "below R=M-4", coverage: "partial", overdue: M, acknowledged: 1, suppressed: 2, unknown: M - 5, deferred: 1 },
    { name: "above R+S=M-2", coverage: "partial", overdue: M, acknowledged: 1, suppressed: 2, unknown: M - 1, deferred: 1 },
    { name: "ACK plus suppression sums to M+1", coverage: "complete", overdue: M, acknowledged: M, suppressed: 1, unknown: 0, deferred: 0 },
    { name: "suppression plus ACK sums to M+1", coverage: "complete", overdue: M, acknowledged: 1, suppressed: M, unknown: 0, deferred: 0 },
    { name: "three exclusive branches sum to M+1", coverage: "partial", overdue: M, acknowledged: M - 1, suppressed: 1, unknown: 0, deferred: 1 },
    { name: "all deferred with complete coverage", coverage: "complete", overdue: M, acknowledged: 0, suppressed: 0, unknown: 0, deferred: M },
  ])("refuses maximum accounting outside producer bounds: $name", ({ name, ...packet }) => {
    const input = { status: "observed", ...packet };
    const before = structuredClone(input), bytes = JSON.stringify(input);
    expect(jobAlertDeliveryObservation(input), name).toEqual({
      status: "unavailable", coverage: "not-observed", overdue: null, transportAcknowledged: null,
      suppressed: null, transportUnknown: null, deferred: null, responderReceived: null,
      customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
    });
    expect(input).toEqual(before);
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])("refuses invalid integer counters %s", invalid => {
    const packet = { status: "observed", coverage: "complete", overdue: 1, acknowledged: 1, suppressed: 0, unknown: 0, deferred: 0 };
    for (const key of ["overdue", "acknowledged", "suppressed", "unknown", "deferred"]) {
      const input = { ...packet, [key]: invalid }, before = structuredClone({ ...packet, [key]: invalid });
      expect(jobAlertDeliveryObservation(input)).toEqual({
        status: "unavailable", coverage: "not-observed", overdue: null, transportAcknowledged: null,
        suppressed: null, transportUnknown: null, deferred: null, responderReceived: null,
        customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
      });
      expect(input).toEqual(before);
    }
  });

  it.each(["disabled", "unbound", "unavailable"])("refuses any nonzero measured field when %s", status => {
    const packet = { status, coverage: "not-observed", overdue: 0, acknowledged: 0, suppressed: 0, unknown: 0, deferred: 0 };
    for (const field of ["overdue", "acknowledged", "suppressed", "unknown", "deferred"]) {
      const input = { ...packet, [field]: 1 }, before = structuredClone({ ...packet, [field]: 1 });
      expect(jobAlertDeliveryObservation(input)).toEqual({
        status: "unavailable", coverage: "not-observed", overdue: null, transportAcknowledged: null,
        suppressed: null, transportUnknown: null, deferred: null, responderReceived: null,
        customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
      });
      expect(input).toEqual(before);
    }
  });

  it("keeps OFF, unbound, unavailable, malformed and unobserved inputs null rather than fake zeros", () => {
    const unobserved = { coverage: "not-observed", overdue: 0, acknowledged: 0, suppressed: 0, unknown: 0, deferred: 0 };
    for (const status of ["disabled", "unbound", "unavailable"]) {
      expect(jobAlertDeliveryObservation({ ...unobserved, status })).toEqual({
        status, coverage: "not-observed", overdue: null, transportAcknowledged: null,
        suppressed: null, transportUnknown: null, deferred: null, responderReceived: null,
        customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
      });
    }
    for (const invalid of [undefined, null, { ...unobserved, status: "observed" },
      { ...unobserved, status: "observed", coverage: "complete", overdue: 1, acknowledged: 2 }]) {
      expect(jobAlertDeliveryObservation(invalid)).toMatchObject({ status: "unavailable", transportUnknown: null });
    }
    expect(jobAlertDeliveryObservation({ ...unobserved, status: "observed", coverage: "complete" }))
      .toMatchObject({ overdue: 0, transportAcknowledged: 0, customerStateDelivered: null });
  });
});
