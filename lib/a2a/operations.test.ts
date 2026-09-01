import { describe, expect, it } from "vitest";
import { summarizeA2aOperations, type A2aOperationsRow } from "./operations";

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
