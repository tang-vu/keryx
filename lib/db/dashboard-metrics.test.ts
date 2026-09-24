import { describe, expect, it } from "vitest";
import {
  calculateDashboardMetrics,
  runEvidenceMetrics,
} from "./dashboard-metrics";

describe("calculateDashboardMetrics", () => {
  it("combines every origin in headline totals", () => {
    const metrics = calculateDashboardMetrics(
      [
        {
          amountUsdc: 0.01,
          sourceId: "s1",
          queryId: "web-1",
          kind: "citation",
          origin: "web",
          settled: true,
          payer: "0xalice",
        },
        {
          amountUsdc: 0.02,
          sourceId: "s1",
          queryId: "engine-1",
          kind: "citation",
          origin: "engine",
          settled: true,
          payer: "0xtreasury",
        },
        {
          amountUsdc: 9,
          sourceId: "s1",
          queryId: "web-2",
          kind: "citation",
          origin: "web",
          settled: false,
          payer: "0xalice",
        },
      ],
      [
        { id: "web-1", origin: "web", asker: "0xAlice", durationMs: 1_000 },
        { id: "web-2", origin: "web", asker: "0xAlice", durationMs: 2_000 },
        { id: "engine-1", origin: "engine", durationMs: 50 },
      ],
    );

    expect(metrics.totalPayments).toBe(2);
    expect(metrics.totalQueries).toBe(3);
    expect(metrics.totalVolumeUsdc).toBe(0.03);
    expect(metrics.totalCreatorPayoutsUsdc).toBe(0.03);
    expect(metrics.payingQueries).toBe(2);
    expect(metrics.readerToPayerConversion).toBe(0.666667);
  });

  it("reports pending confirmations without promoting them into traction", () => {
    const metrics = calculateDashboardMetrics(
      [
        {
          amountUsdc: 0.004,
          sourceId: "s1",
          queryId: "web-pending",
          kind: "citation",
          origin: "web",
          settled: false,
          settlementStatus: "pending",
        },
      ],
      [{ id: "web-pending", origin: "web" }],
    );

    expect(metrics.totalPayments).toBe(0);
    expect(metrics.totalVolumeUsdc).toBe(0);
    expect(metrics.payingQueries).toBe(0);
    expect(metrics.pendingPaymentConfirmations).toBe(1);
    expect(metrics.pendingPaymentVolumeUsdc).toBe(0.004);
  });

  it("reports failed receipts without counting them as spend or traction", () => {
    const metrics = calculateDashboardMetrics(
      [{
        amountUsdc: 0.006,
        sourceId: "s1",
        queryId: "web-failed",
        kind: "fetch",
        origin: "web",
        settled: false,
        settlementStatus: "failed",
      }],
      [{ id: "web-failed", origin: "web" }],
    );

    expect(metrics.totalPayments).toBe(0);
    expect(metrics.totalVolumeUsdc).toBe(0);
    expect(metrics.pendingPaymentConfirmations).toBe(0);
    expect(metrics.failedPaymentAttempts).toBe(1);
    expect(metrics.failedPaymentVolumeUsdc).toBe(0.006);
  });

  it("counts A2A payments and feedback in the combined totals", () => {
    const metrics = calculateDashboardMetrics(
      [
        {
          amountUsdc: 0.02,
          sourceId: "keryx",
          queryId: "a2a-1",
          kind: "inbound",
          origin: "a2a",
          settled: true,
          payer: "0xAgent",
        },
        {
          amountUsdc: 0.02,
          sourceId: "keryx",
          queryId: "a2a-2",
          kind: "inbound",
          origin: "a2a",
          settled: true,
          payer: "0xAgent",
        },
      ],
      [
        {
          id: "a2a-1",
          origin: "a2a",
          paymentMode: "real",
          paymentAttempts: 2,
          settledPayments: 2,
          confidenceLevel: "High",
        },
        {
          id: "a2a-2",
          origin: "a2a",
          paymentMode: "real",
          paymentAttempts: 2,
          settledPayments: 1,
          confidenceLevel: "Low",
        },
        { id: "anon", origin: "web" },
      ],
      [
        { queryId: "a2a-1", rating: "up" },
        { queryId: "a2a-2", rating: "down" },
        { queryId: "internal", rating: "up" },
      ],
    );

    expect(metrics.totalQueries).toBe(3);
    expect(metrics.totalPayments).toBe(2);
    expect(metrics.totalVolumeUsdc).toBe(0.04);
    expect(metrics.feedbackTotal).toBe(3);
    expect(metrics.satisfactionRate).toBe(0.666667);
  });

  it("includes Remote MCP in totals and tracks its integration channel", () => {
    const metrics = calculateDashboardMetrics(
      [
        {
          amountUsdc: 0.01,
          sourceId: "creator",
          queryId: "mcp-1",
          kind: "citation",
          origin: "mcp",
          settled: true,
        },
      ],
      [
        { id: "mcp-1", origin: "mcp", asker: "0xMcpAgent", mcpClient: "codex" },
        { id: "mcp-2", origin: "mcp", asker: "0xmcpagent", mcpClient: "codex" },
        { id: "mcp-anon", origin: "mcp" },
      ],
    );

    expect(metrics.totalQueries).toBe(3);
    expect(metrics.totalCreatorPayoutsUsdc).toBe(0.01);
    expect(metrics.mcpClientQueries).toEqual([
      { client: "codex", queries: 2, payingQueries: 1 },
      { client: "unknown", queries: 1, payingQueries: 0 },
    ]);
  });

  it("includes historical runs without an origin in the total", () => {
    const metrics = calculateDashboardMetrics([], [
      { id: "legacy", origin: null, asker: "0xmaybe" },
      { id: "engine", origin: "engine" },
    ]);
    expect(metrics.totalQueries).toBe(2);
  });

  it("reports evidence grounding without inventing samples for historical runs", () => {
    const metrics = calculateDashboardMetrics([], [
      { id: "historical", origin: "engine" },
      {
        id: "grounded",
        origin: "web",
        evidenceClaimCount: 2,
        groundedClaimCount: 2,
        rewardedCitationCount: 1,
      },
      {
        id: "withheld",
        origin: "engine",
        evidenceClaimCount: 2,
        groundedClaimCount: 0,
        rewardedCitationCount: 0,
      },
    ]);

    expect(metrics.evidenceRunSamples).toBe(2);
    expect(metrics.evidenceClaimSamples).toBe(4);
    expect(metrics.groundedClaimRate).toBe(0.5);
    expect(metrics.citationPoolWithheldRuns).toBe(1);
  });

  it("derives additive evidence telemetry from QueryRun JSON", () => {
    expect(
      runEvidenceMetrics({
        citations: [{ sourceId: "s1" }],
        claimCoverage: [
          { claimIndex: 0, claim: "a", coverage: 0.8, coveredBy: ["S1"] },
          { claimIndex: 1, claim: "b", coverage: 0.1, coveredBy: [] },
        ],
      }),
    ).toEqual({
      evidenceClaimCount: 2,
      groundedClaimCount: 1,
      rewardedCitationCount: 1,
    });
    expect(runEvidenceMetrics("{}").evidenceClaimCount).toBeNull();
  });

  it("reports the wanted-claim fulfillment funnel separately from query traction", () => {
    const metrics = calculateDashboardMetrics([], [], [], [
      { status: "filled" },
      { status: "pending" },
      { status: "running" },
      { status: "missed" },
    ]);
    expect(metrics.gapIntentOffers).toBe(4);
    expect(metrics.gapIntentFilled).toBe(1);
    expect(metrics.gapIntentPending).toBe(2);
    expect(metrics.gapIntentFillRate).toBe(0.25);
  });
});
