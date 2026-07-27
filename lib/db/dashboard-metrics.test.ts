import { describe, expect, it } from "vitest";
import { calculateDashboardMetrics } from "./dashboard-metrics";

describe("calculateDashboardMetrics", () => {
  it("keeps internal volume out of the primary external KPIs", () => {
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
    expect(metrics.externalQueries).toBe(2);
    expect(metrics.engineQueries).toBe(1);
    expect(metrics.externalPayingQueries).toBe(1);
    expect(metrics.externalReaderToPayerConversion).toBe(0.5);
    expect(metrics.externalCreatorPayoutsUsdc).toBe(0.01);
    expect(metrics.externalAvgCostPerQueryUsdc).toBe(0.005);
    expect(metrics.returningExternalActors).toBe(1);
    expect(metrics.externalP95DurationMs).toBe(2_000);
  });

  it("attributes A2A actors only from settled inbound payer evidence", () => {
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

    expect(metrics.identifiedExternalActors).toBe(1);
    expect(metrics.returningExternalActors).toBe(1);
    expect(metrics.returningExternalActorRate).toBe(1);
    expect(metrics.externalFeedbackTotal).toBe(2);
    expect(metrics.externalSatisfactionRate).toBe(0.5);
    expect(metrics.externalHighConfidenceRate).toBe(0.5);
    expect(metrics.externalSettlementAttempts).toBe(4);
    expect(metrics.externalSettledPayments).toBe(3);
    expect(metrics.externalSettlementSuccessRate).toBe(0.75);
  });

  it("counts Remote MCP as external and attributes only verified key wallets", () => {
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

    expect(metrics.externalQueries).toBe(3);
    expect(metrics.engineQueries).toBe(0);
    expect(metrics.identifiedExternalActors).toBe(1);
    expect(metrics.returningExternalActors).toBe(1);
    expect(metrics.externalCreatorPayoutsUsdc).toBe(0.01);
    expect(metrics.mcpClientQueries).toEqual([
      { client: "codex", queries: 2, payingQueries: 1 },
      { client: "unknown", queries: 1, payingQueries: 0 },
    ]);
  });

  it("treats legacy unknown origins as internal", () => {
    const metrics = calculateDashboardMetrics([], [
      { id: "legacy", origin: null, asker: "0xmaybe" },
      { id: "engine", origin: "engine" },
    ]);
    expect(metrics.externalQueries).toBe(0);
    expect(metrics.engineQueries).toBe(2);
  });

  it("does not turn missing historical latency into a zero-millisecond sample", () => {
    const metrics = calculateDashboardMetrics([], [
      { id: "historical", origin: "web", durationMs: null },
      { id: "current", origin: "web", durationMs: 1_250 },
    ]);
    expect(metrics.externalDurationSamples).toBe(1);
    expect(metrics.externalAvgDurationMs).toBe(1_250);
    expect(metrics.externalP95DurationMs).toBe(1_250);
  });
});
