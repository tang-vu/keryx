import { describe, expect, it } from "vitest";
import { summarizeA2aOperations, type A2aOperationsRow } from "./operations";
import { completionFixtureRows, COMPLETION_FIXTURE_NOW, ordinaryCompletion, recoveredCompletion } from "./completion-latency.test-support";

const now = Date.parse("2026-09-01T12:00:00.000Z");

function row(overrides: Partial<A2aOperationsRow>): A2aOperationsRow {
  return {
    status: "running",
    createdAt: "2026-09-01T11:59:30.000Z",
    updatedAt: "2026-09-01T11:59:30.000Z",
    startedAt: null,
    ...overrides,
  };
}

describe("A2A operations snapshot", () => {
  it("classifies queue, processing, and exact review boundaries without identifiers", () => {
    const snapshot = summarizeA2aOperations(
      [
        row({ createdAt: "2026-09-01T11:57:59.000Z" }),
        row({ startedAt: "2026-09-01T11:45:01.000Z" }),
        row({ startedAt: "2026-09-01T11:45:00.000Z" }),
        row({ startedAt: "not-a-timestamp" }),
      ],
      now,
    );
    expect(snapshot).toMatchObject({
      queued: 1,
      processing: 1,
      reviewRequired: 2,
      oldestQueuedAgeSeconds: 121,
      oldestProcessingAgeSeconds: 900,
      degraded: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("a2a_");
  });

  it("reports rolling terminal completion and nearest-rank latency percentiles", () => {
    const snapshot = summarizeA2aOperations(
      [
        row({
          status: "completed",
          createdAt: "2026-09-01T11:59:50.000Z",
          updatedAt: "2026-09-01T11:59:51.000Z",
          startedAt: "2026-09-01T11:59:50.100Z",
        }),
        row({
          status: "completed",
          createdAt: "2026-09-01T11:59:40.000Z",
          updatedAt: "2026-09-01T11:59:45.000Z",
          startedAt: "2026-09-01T11:59:40.100Z",
        }),
        row({ status: "failed", updatedAt: "2026-09-01T11:59:00.000Z" }),
        row({ status: "failed", updatedAt: "2026-08-30T00:00:00.000Z" }),
      ],
      now,
    );
    expect(snapshot).toMatchObject({
      completedLast24h: 2,
      failedLast24h: 1,
      completionRateLast24h: 0.6667,
      completionLatencyP50Ms: 1_000,
      completionLatencyP95Ms: 5_000,
      degraded: false,
    });
  });
});

describe("recorded completion latency cohorts", () => {
  it("separates ordinary delivery from 52-hour repair, original fulfillment and unknown history", () => {
    const snapshot = summarizeA2aOperations(completionFixtureRows(), COMPLETION_FIXTURE_NOW, true);
    expect(snapshot.completedLast24h).toBe(6);
    expect(snapshot.completionLatencyP95Ms).toBe(52 * 60 * 60_000); // Compatible all-path percentile stays mixed.
    expect(snapshot.completionLatencyCohorts).toEqual({
      ordinary: { completed: 2, timedSamples: 2, p50Ms: 1000, p95Ms: 3000 },
      recovered: { completed: 2, timedSamples: 2, p50Ms: 5000, p95Ms: 52 * 60 * 60_000 },
      unknown: { completed: 2, timedSamples: 1, p50Ms: 2000, p95Ms: 2000 },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/claimId|authoritySha|question|payer|serviceReceipt|packageVersion/);
  });

  it("keeps unavailable marker capability separate from no completed samples", () => {
    expect(summarizeA2aOperations(completionFixtureRows(), COMPLETION_FIXTURE_NOW).completionLatencyCohorts).toBeNull();
    expect(summarizeA2aOperations([], COMPLETION_FIXTURE_NOW, true).completionLatencyCohorts).toEqual({
      ordinary: { completed: 0, timedSamples: 0, p50Ms: null, p95Ms: null },
      recovered: { completed: 0, timedSamples: 0, p50Ms: null, p95Ms: null },
      unknown: { completed: 0, timedSamples: 0, p50Ms: null, p95Ms: null },
    });
  });

  it("reports the retained update endpoint even when an ordinary receipt finished earlier", () => {
    const row = ordinaryCompletion(31_000);
    row.serviceReceipt = { ...(row.serviceReceipt as object),
      finishedAt: new Date(COMPLETION_FIXTURE_NOW - 30_000).toISOString() };
    const snapshot = summarizeA2aOperations([row], COMPLETION_FIXTURE_NOW, true);
    expect(snapshot.completionLatencyCohorts?.ordinary).toEqual({
      completed: 1, timedSamples: 1, p50Ms: 31_000, p95Ms: 31_000,
    });
    // Receipt qualification does not turn updatedAt into a first-result clock.
    expect(snapshot.completionLatencyP50Ms).toBe(31_000);
  });

  it.each([
    { resolution: {} }, { resolution: { action: "repair_completed", reason: "saved_real_query_run", resolvedAt: new Date(COMPLETION_FIXTURE_NOW).toISOString(), evidence: { queryRunFound: true } } },
    { resolution: { ...(recoveredCompletion(1000).resolution as object), resolvedAt: "2026-10-08T23:59:59.000Z" } },
    { resolution: { ...(recoveredCompletion(1000).resolution as object), actor: ["operator-cli"] } },
    { executionJournalVersion: null }, { serviceReceipt: "untrusted text" },
    { serviceReceipt: { ...(ordinaryCompletion(1000).serviceReceipt as object), finishedAt: "2026-02-30T00:00:00.000Z" } },
    { serviceReceipt: { ...(ordinaryCompletion(1000).serviceReceipt as object), packageVersion: "unknown" } },
    { serviceReceipt: { ...(ordinaryCompletion(1000).serviceReceipt as object), acceptedAt: "2026-10-08T00:00:00.000Z" } },
    { resolution: undefined },
  ])("does not promote absent, malformed, conflicting or unbound markers ($index)", mutation => {
    const snapshot = summarizeA2aOperations([{ ...ordinaryCompletion(1000), ...mutation }], COMPLETION_FIXTURE_NOW, true);
    expect(snapshot.completionLatencyCohorts?.ordinary.completed).toBe(0);
    expect(snapshot.completionLatencyCohorts?.recovered.completed).toBe(0);
    expect(snapshot.completionLatencyCohorts?.unknown.completed).toBe(1);
  });

  it("does not coerce matching malformed package identifiers into supported versions", () => {
    const row = ordinaryCompletion(1000), id = ["keryx-quick"];
    row.researchPackage = { ...(row.researchPackage as object), id };
    row.serviceReceipt = { ...(row.serviceReceipt as object), packageId: id };
    expect(summarizeA2aOperations([row], COMPLETION_FIXTURE_NOW, true)
      .completionLatencyCohorts?.unknown.completed).toBe(1);
  });

  it("keeps older/future completions and running originals out of every completion cohort", () => {
    const running = { ...ordinaryCompletion(1000), status: "running" as const, startedAt: new Date(COMPLETION_FIXTURE_NOW - 16 * 60_000).toISOString() };
    const snapshot = summarizeA2aOperations([running,
      { ...recoveredCompletion(1000), updatedAt: new Date(COMPLETION_FIXTURE_NOW - 25 * 60 * 60_000).toISOString() },
      { ...ordinaryCompletion(1000), updatedAt: new Date(COMPLETION_FIXTURE_NOW + 1).toISOString() }], COMPLETION_FIXTURE_NOW, true);
    expect(snapshot).toMatchObject({ reviewRequired: 1, completedLast24h: 0, degraded: true });
    expect(snapshot.completionLatencyCohorts?.ordinary.p50Ms).toBeNull();
    expect(snapshot.completionLatencyCohorts?.recovered.completed).toBe(0);
  });
});
