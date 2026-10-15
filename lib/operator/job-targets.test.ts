import { describe, expect, it, vi } from "vitest";
import { a2aResearchPackage } from "../a2a/research-package-definition";
import { paidJobEscalation } from "../a2a/overdue-status";
import type { A2aOrder } from "../a2a/order";
import type { PaymentRecord } from "../types";
import { jobAlertDeliveryObservation, jobCompletionMetrics, jobCompletionTarget, jobTargetCustomerState, jobTargetNeedsReview, jobTargetWarningDelay } from "./job-targets";
import { paidJobEscalationQueue } from "../a2a/overdue-escalation-queue";
import { createPaidJobAlertObserver, type PaidJobAlert } from "../a2a/paid-job-alert-observer";
import { paidJobAlertChannel } from "../notify/paid-job-alert";
import { sendAlert } from "../notify/alert";

vi.mock("../notify/alert", () => ({ operationalAlertChannelsReady: () => true, sendAlert: vi.fn(async () => true) }));
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

/** In-memory originals/retained metadata only; unexpected storage/financial calls fail. */
function attentionFixture(status: A2aOrder["status"] = "running") {
  const id = `a2a_${"d".repeat(64)}`;
  const row: A2aOrder = { ...original, id, queryId: id, status, workerId: "PRIVATE_WORKER",
    errorCode: status === "failed" ? "research_failed" : null, transaction: "synthetic-original-reference",
    amountUsdc: 0.05, updatedAt: new Date(accepted + 3000).toISOString() };
  const leg = { ...uncertain, queryId: id };
  const state = new Map<string, string>();
  const held = { workerId: row.workerId, status: "recovery_pending", orderId: id, updatedAt: new Date(accepted + 4000).toISOString() };
  const rows = [row];
  const methods = {
    listUnfinishedA2aOrders: vi.fn(async (_limit: number) => ({ orders: rows.filter(order => order.status !== "completed"), unreadable: 0, truncated: false })),
    listCreatorPaymentAttemptsByQuery: vi.fn(async (_id: string) => [leg]),
    getSyncState: vi.fn(async (key: string) => state.get(key) ?? null),
    setSyncState: vi.fn(async (key: string, value: string) => {
      expect(key).toMatch(/^paidJobDeadlineAlert:[a-f0-9]{64}$/);
      state.set(key, value);
    }),
  };
  const db = new Proxy(methods, { get(target, key) {
    if (key in target) return Reflect.get(target, key);
    throw new Error(`Unauthorized fixture operation: ${String(key)}`);
  } });
  const channel = { ready: vi.fn(() => true), send: vi.fn(async (_alert: PaidJobAlert) => true) };
  const scope = { network: "eip155:5042002", payee: provider };
  let now = accepted + 60_000;
  return { row, rows, leg, held, state, methods, db, channel, scope,
    setNow: (value: number) => { now = value; },
    observer: () => createPaidJobAlertObserver({ db, channel, ...scope, enabled: true, clock: () => now }) };
}

describe("reachable predeadline original attention", () => {
  it.each(["failed", "held"])("queues and privately observes a genuine %s original before its unchanged target", async kind => {
    const f = attentionFixture(kind === "failed" ? "failed" : "running");
    if (kind === "held") f.state.set("a2aWorker", JSON.stringify(f.held));
    const before = JSON.stringify([f.row, f.leg, f.state.get("a2aWorker")]);
    const queue = await paidJobEscalationQueue(f.db, accepted + 60_000, 50, f.scope);
    expect(queue).toMatchObject({ scanned: 1, withinTarget: 0, overdue: [], attentionNeeded: true });
    expect(queue.predeadlineAttention).toHaveLength(1);
    expect(queue.predeadlineAttention[0]).toMatchObject({ operationalState: kind === "failed" ? "failed" : "review_required",
      escalation: { state: "within_target", escalationNeeded: false, elapsedMs: 60_000,
        targetCompletionAt: new Date(accepted + 180_000).toISOString(), creatorPaymentState: "pending_recorded" } });
    const result = await f.observer().observe();
    expect(result).toMatchObject({ status: "observed", overdue: 0, acknowledged: 0, suppressed: 0, unknown: 0,
      predeadlineAttention: { needsReview: 1, acknowledged: 1, suppressed: 0, unknown: 0, deferred: 0 } });
    expect(f.methods.listUnfinishedA2aOrders).toHaveBeenLastCalledWith(50);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(JSON.stringify([result, f.channel.send.mock.calls])).not.toMatch(/PRIVATE_|workerId|authorizationId|requestHash|question/);
    expect(JSON.stringify([f.row, f.leg, f.state.get("a2aWorker")])).toBe(before);
    expect(jobAlertDeliveryObservation(result)).toMatchObject({ overdue: 0, transportAcknowledged: 0,
      predeadlineAttention: result.predeadlineAttention, responderReceived: null, customerStateDelivered: null, targetWindowMet: null });
  });

  it.each(["quick", "deep"] as const)("keeps %s review distinct at the exact deadline and suppresses the later overdue incident", async mode => {
    const f = attentionFixture("failed");
    f.row.researchMode = mode; f.row.researchPackage = a2aResearchPackage(mode);
    const target = mode === "quick" ? 180_000 : 300_000;
    f.setNow(accepted + target);
    const observer = f.observer();
    expect(await observer.observe()).toMatchObject({ overdue: 0, predeadlineAttention: { needsReview: 1, acknowledged: 1 } });
    f.setNow(accepted + target + 1);
    const late = await observer.observe();
    expect(late).toMatchObject({ overdue: 1, acknowledged: 0, suppressed: 1,
      predeadlineAttention: { needsReview: 0, acknowledged: 0, suppressed: 0 } });
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(jobAlertDeliveryObservation(late)).toMatchObject({ overdue: 1, suppressed: 1, transportAcknowledged: 0 });
  });

  it.each(["missing", "malformed", "foreign-order", "foreign-worker", "future", "before-update", "processing", "unreadable", "invalid-start", "missing-worker"])(
    "does not turn %s recovery evidence or uncertain creator metrics into a hold", async kind => {
      const f = attentionFixture();
      const record = { ...f.held };
      if (kind === "foreign-order") record.orderId = `a2a_${"e".repeat(64)}`;
      if (kind === "foreign-worker") record.workerId = "FOREIGN_WORKER";
      if (kind === "future") record.updatedAt = new Date(accepted + 60_001).toISOString();
      if (kind === "before-update") record.updatedAt = new Date(accepted + 2000).toISOString();
      if (kind === "processing") record.status = "processing";
      if (kind === "invalid-start") f.row.startedAt = "invalid";
      if (kind === "missing-worker") f.row.workerId = null;
      if (kind !== "missing") f.state.set("a2aWorker", kind === "malformed" ? "{" : JSON.stringify(record));
      if (kind === "unreadable") f.methods.getSyncState.mockRejectedValue(new Error("PRIVATE_READ_FAILURE"));
      f.row.executionJournalVersion = null; // Missing stage/payment capability never proves a hold.
      const queue = await paidJobEscalationQueue(f.db, accepted + 60_000, 50, f.scope);
      expect(queue).toMatchObject({ withinTarget: 1, predeadlineAttention: [], overdue: [], attentionNeeded: false });
      const result = await f.observer().observe();
      expect(result).toMatchObject({ overdue: 0, predeadlineAttention: { needsReview: 0, acknowledged: 0 } });
      expect(f.methods.listCreatorPaymentAttemptsByQuery).not.toHaveBeenCalled();
      expect(f.methods.setSyncState).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
      expect(jobTargetNeedsReview(paidJobEscalation(f.row, accepted + 60_000), "processing")).toBe(false);
    });

  it.each(["profile", "payee", "missing-profile"])("refuses a foreign %s original before creator reads or private sends", async kind => {
    const f = attentionFixture(); f.state.set("a2aWorker", JSON.stringify(f.held));
    f.row.request = { ...f.row.request! };
    if (kind === "profile") f.row.request.network = "eip155:5042";
    if (kind === "payee") f.row.payee = `0x${"a".repeat(40)}`;
    if (kind === "missing-profile") delete f.row.request.network;
    expect(await f.observer().observe()).toMatchObject({ overdue: 0, predeadlineAttention: { needsReview: 0 } });
    expect(f.methods.listCreatorPaymentAttemptsByQuery).not.toHaveBeenCalled();
    expect(f.methods.getSyncState).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
  });

  it.each(["createdAt", "startedAt", "updatedAt", "heldAt"] as const)(
    "refuses date-only, unqualified, invalid-calendar and submillisecond %s before reserving an incident", async field => {
      for (const value of ["2026-10-12", "2026-10-12T00:00:00", "2026-02-30T00:00:00.000Z",
        `2026-10-12T00:00:${field === "createdAt" ? "00" : field === "startedAt" ? "01" : field === "updatedAt" ? "03" : "04"}.0001Z`]) {
        const f = attentionFixture();
        if (field === "heldAt") f.held.updatedAt = value; else f.row[field] = value;
        f.state.set("a2aWorker", JSON.stringify(f.held));
        expect((await paidJobEscalationQueue(f.db, accepted + 60_000, 50, f.scope)).predeadlineAttention).toEqual([]);
        await f.observer().observe();
        expect(f.methods.setSyncState).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
      }
    });

  it.each(["accept-after-start", "start-after-update", "update-after-hold", "future-hold", "fraction-reversed", "fraction-future", "unknown-offset"])(
    "refuses %s chronology without consuming the original incident", async kind => {
      const f = attentionFixture();
      if (kind === "accept-after-start") f.row.createdAt = new Date(accepted + 2000).toISOString();
      if (kind === "start-after-update") f.row.startedAt = new Date(accepted + 3500).toISOString();
      if (kind === "update-after-hold") f.row.updatedAt = new Date(accepted + 4500).toISOString();
      if (kind === "future-hold") f.held.updatedAt = new Date(accepted + 60_001).toISOString();
      if (kind === "fraction-reversed") {
        f.row.updatedAt = "2026-10-12T00:00:04.0009Z"; f.held.updatedAt = "2026-10-12T00:00:04.0001Z";
      }
      if (kind === "fraction-future") f.held.updatedAt = "2026-10-12T00:01:00.0001Z";
      if (kind === "unknown-offset") f.row.startedAt = "2026-10-12T00:00:01-00:00";
      f.state.set("a2aWorker", JSON.stringify(f.held));
      expect((await paidJobEscalationQueue(f.db, accepted + 60_000, 50, f.scope)).predeadlineAttention).toEqual([]);
      await f.observer().observe();
      expect(f.methods.setSyncState).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
    });

  it.each(["offset", "leap-day", "equal"])("accepts valid %s chronology without changing original amounts", async kind => {
    const f = attentionFixture(); let now = accepted + 60_000;
    if (kind === "offset") {
      f.row.createdAt = "2026-10-12T07:00:00+07:00"; f.row.startedAt = "2026-10-12T07:00:01.1+07:00";
      f.row.updatedAt = "2026-10-12T07:00:03.12+07:00"; f.held.updatedAt = "2026-10-12T07:00:04.123+07:00";
    }
    if (kind === "leap-day") {
      f.row.createdAt = "2028-02-29T00:00:00.000Z"; f.row.startedAt = "2028-02-29T00:00:01.000Z";
      f.row.updatedAt = "2028-02-29T00:00:03.000Z"; f.held.updatedAt = "2028-02-29T00:00:04.000Z";
      now = Date.parse("2028-02-29T00:01:00.000Z");
    }
    if (kind === "equal") f.row.startedAt = f.row.updatedAt = f.held.updatedAt = f.row.createdAt;
    f.state.set("a2aWorker", JSON.stringify(f.held));
    const before = JSON.stringify([f.row, f.leg, f.held]);
    expect((await paidJobEscalationQueue(f.db, now, 50, f.scope)).predeadlineAttention[0]).toMatchObject({ operationalState: "review_required" });
    expect(JSON.stringify([f.row, f.leg, f.held])).toBe(before);
  });

  it("preserves unknown-transport suppression and one shared four-attempt bound across both queues", async () => {
    const f = attentionFixture("failed");
    f.channel.send.mockResolvedValue(false);
    expect(await f.observer().observe()).toMatchObject({ predeadlineAttention: { needsReview: 1, unknown: 1 } });
    expect(await f.observer().observe()).toMatchObject({ predeadlineAttention: { needsReview: 1, suppressed: 1, unknown: 1 } });
    expect(f.channel.send).toHaveBeenCalledOnce();
    const bounded = attentionFixture("failed");
    for (let i = 1; i <= 4; i++) {
      const id = `a2a_${i.toString(16).padStart(64, "0")}`;
      bounded.rows.push({ ...bounded.row, id, queryId: id,
        createdAt: new Date(accepted - (i <= 2 ? 180_000 : 0)).toISOString() });
    }
    const result = await bounded.observer().observe();
    expect(result).toMatchObject({ overdue: 2, acknowledged: 2, coverage: "partial",
      predeadlineAttention: { needsReview: 3, acknowledged: 2, deferred: 1 } });
    expect(bounded.channel.send).toHaveBeenCalledTimes(4);
    expect(jobAlertDeliveryObservation(result).status).toBe("observed");
  });

  it("uses the actual notifier's separate truthful review and late titles without leaking the private worker", async () => {
    const f = attentionFixture(); f.state.set("a2aWorker", JSON.stringify(f.held));
    const channel = paidJobAlertChannel();
    const review = (await paidJobEscalationQueue(f.db, accepted + 60_000, 50, f.scope)).predeadlineAttention[0];
    vi.mocked(sendAlert).mockClear();
    await channel.send({ incidentId: "a".repeat(64), original: review });
    expect(sendAlert).toHaveBeenLastCalledWith("Paid job needs review before its completion target", expect.stringContaining("timing: within_target"), { logDetail: false });
    const late = (await paidJobEscalationQueue(f.db, accepted + 180_001, 50, f.scope)).overdue[0];
    await channel.send({ incidentId: "b".repeat(64), original: late });
    expect(sendAlert).toHaveBeenLastCalledWith("Paid job completion target exceeded", expect.stringContaining("timing: overdue"), { logDetail: false });
    expect(JSON.stringify(vi.mocked(sendAlert).mock.calls)).not.toMatch(/PRIVATE_|workerId|question|authorizationId/);
  });

  it("keeps completed originals out of attention and unobserved/missing capability counters null", async () => {
    const f = attentionFixture("completed"); f.state.set("a2aWorker", JSON.stringify(f.held));
    expect(await f.observer().observe()).toMatchObject({ overdue: 0, predeadlineAttention: { needsReview: 0 } });
    expect(f.channel.send).not.toHaveBeenCalled();
    const counters = { needsReview: 0, acknowledged: 0, suppressed: 0, unknown: 0, deferred: 0 };
    const zero = { status: "observed", coverage: "complete", overdue: 0, acknowledged: 0, suppressed: 0, unknown: 0, deferred: 0 };
    expect(jobAlertDeliveryObservation(zero).predeadlineAttention).toBeNull();
    expect(jobAlertDeliveryObservation({ ...zero, predeadlineAttention: counters }).predeadlineAttention).toEqual(counters);
    for (const status of ["disabled", "unbound", "unavailable"]) {
      expect(jobAlertDeliveryObservation({ ...zero, status, coverage: "not-observed", predeadlineAttention: counters }).predeadlineAttention).toBeNull();
    }
    for (const invalid of [{ ...counters, needsReview: null }, { ...counters, needsReview: 1 },
      { ...counters, needsReview: 1, unknown: 1, deferred: 1 }, { ...counters, needsReview: 1, deferred: 1 }]) {
      expect(jobAlertDeliveryObservation({ ...zero, predeadlineAttention: invalid })).toMatchObject({ status: "unavailable", predeadlineAttention: null });
    }
  });
});

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
      predeadlineAttention: null, responderReceived: null, customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized" });
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
      suppressed: null, transportUnknown: null, deferred: null, predeadlineAttention: null, responderReceived: null,
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
      suppressed: 2, transportUnknown: unknown, deferred: 1, predeadlineAttention: null, responderReceived: null,
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
        suppressed: 0, transportUnknown: 0, deferred: 0, predeadlineAttention: null, responderReceived: null,
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
      predeadlineAttention: null, responderReceived: null, customerStateDelivered: null, targetWindowMet: null, automaticResend: "not_authorized",
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
      suppressed: null, transportUnknown: null, deferred: null, predeadlineAttention: null, responderReceived: null,
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
        suppressed: null, transportUnknown: null, deferred: null, predeadlineAttention: null, responderReceived: null,
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
        suppressed: null, transportUnknown: null, deferred: null, predeadlineAttention: null, responderReceived: null,
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
        suppressed: null, transportUnknown: null, deferred: null, predeadlineAttention: null, responderReceived: null,
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
