import { beforeEach, expect, it, vi } from "vitest";
import { calculateDashboardMetrics } from "../db/dashboard-metrics";

const calls = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: calls.getDb }));
vi.mock("@/lib/config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, registryReadAddress: undefined } };
});
import { GET as health } from "@/app/api/health/route";
import { GET as metrics } from "@/app/api/metrics/route";
import { openapiSpec } from "../openapi-spec";

beforeEach(() => vi.clearAllMocks());

it("publishes unavailable factual grounding on health and metrics despite previously grounded demo counters, preserving settlement telemetry", async () => {
  const aggregate = calculateDashboardMetrics([
    { queryId: "old-demo", sourceId: "demo", kind: "citation", amountUsdc: 0.003, settled: true },
    { queryId: "pending", sourceId: "pending", kind: "fetch", amountUsdc: 0.004, settled: false, settlementStatus: "pending" },
  ], [{ id: "old-demo", evidenceClaimCount: 1, groundedClaimCount: 1, rewardedCitationCount: 1 }]);
  const db = {
    metrics: vi.fn(async () => aggregate), getSyncState: vi.fn(async () => null),
    a2aOperationsSnapshot: vi.fn(async () => ({ degraded: false })), creatorLeaderboard: vi.fn(async () => []),
    listPayments: vi.fn(async () => []), listSources: vi.fn(async () => []), dailySettled: vi.fn(async () => []),
    getFeedbackStats: vi.fn(async () => ({ rate: 0, total: 0 })), activationFunnel: vi.fn(async () => undefined),
  };
  calls.getDb.mockResolvedValue(db);
  const healthResponse = await health(), metricsResponse = await metrics();
  expect(healthResponse.status).toBe(200);
  expect(metricsResponse.status).toBe(200);
  const healthBody = await healthResponse.json(), metricsBody = await metricsResponse.json();
  for (const snapshot of [healthBody.traction, metricsBody.metrics]) {
    expect(snapshot.groundedClaimRate).toBeNull();
    expect(snapshot.evidenceQuality).toMatchObject({ status: "unavailable", basis: "recorded-unreassessed" });
    expect(snapshot.evidenceQuality.explanation).toContain("have not been reassessed");
    expect(snapshot).toMatchObject({ totalPayments: 1, creatorsEarning: 1,
      pendingPaymentConfirmations: 1, pendingPaymentVolumeUsdc: 0.004 });
  }
  expect(healthBody.traction.creatorPayoutsUsdc).toBe(0.003);
  expect(metricsBody.metrics.totalCreatorPayoutsUsdc).toBe(0.003);
  expect(metricsBody.metrics.evidenceClaimSamples).toBe(1);
});

it("documents aggregate unavailability separately from measurable per-run A2A quality", () => {
  expect(openapiSpec.components.schemas.DashboardGroundingStatus.properties.groundedClaimRate.type).toBe("null");
  expect(openapiSpec.components.schemas.DashboardGroundingStatus.properties.evidenceQuality.properties.basis.const).toBe("recorded-unreassessed");
  expect(openapiSpec.components.schemas.A2aServiceReceipt.properties.quality.properties.groundedClaimRate.type).toEqual(["number", "null"]);
});
