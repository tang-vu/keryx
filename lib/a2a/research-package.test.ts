import { describe, expect, it } from "vitest";
import type { QueryRun } from "../types";
import {
  A2A_RESEARCH_PACKAGE_VERSION,
  acceptsA2aPackageVersion,
  a2aResearchPackage,
  a2aResearchPackageForVersion,
  completedA2aServiceReceipt,
  failedA2aServiceReceipt,
  isSupportedA2aResearchPackage,
  pendingA2aServiceStatus,
  supportedA2aPackageVersions,
} from "./research-package";

const run: QueryRun = {
  id: "a2a_result",
  question: "q",
  budget: 0.05,
  researchMode: "deep",
  engine: "test",
  subClaims: ["claim one", "claim two"],
  decisions: [],
  citations: [
    {
      marker: "S1",
      sourceId: "source",
      sourceName: "Source",
      weight: 1,
      reward: 0.01,
      rationale: "supported",
    },
  ],
  evidence: [
    {
      claimIndex: 0,
      claim: "claim one",
      marker: "S1",
      sourceId: "source",
      sourceName: "Source",
      quote: "qualifying quote",
      support: 0.8,
      qualifiesForReward: true,
    },
  ],
  claimCoverage: [
    { claimIndex: 0, claim: "claim one", coverage: 0.8, coveredBy: ["S1"] },
    { claimIndex: 1, claim: "claim two", coverage: 0.2, coveredBy: [] },
  ],
  answer: "answer [S1]",
  totalSpent: 0.01,
  totalToCreators: 0.01,
  trace: [],
  createdAt: "2026-09-02T00:04:00.000Z",
  durationMs: 210_000,
  paymentMode: "real",
  confidence: { level: "Moderate", reason: "one claim remains thin" },
};

describe("versioned A2A research packages", () => {
  it("publishes immutable Quick and Deep execution/SLO contracts", () => {
    expect(a2aResearchPackage("quick")).toMatchObject({
      id: "keryx-quick",
      version: A2A_RESEARCH_PACKAGE_VERSION,
      execution: { attentionLimit: 2, reevaluateRounds: 0 },
      serviceLevel: { kind: "provisional_slo", targetCompletionMs: 180_000, remedy: "none" },
    });
    const deep = a2aResearchPackage("deep");
    expect(deep).toMatchObject({
      id: "keryx-deep",
      execution: { attentionLimit: 4, reevaluateRounds: 1 },
      quality: { groundingThreshold: 0.4, commitment: "best_effort" },
    });
    expect(isSupportedA2aResearchPackage(deep, "deep")).toBe(true);
    deep.execution.attentionLimit = 99;
    expect(isSupportedA2aResearchPackage(deep, "deep")).toBe(false);
    expect(a2aResearchPackage("deep").execution.attentionLimit).toBe(4);
    expect(supportedA2aPackageVersions()).toEqual(["1.0.0"]);
    expect(acceptsA2aPackageVersion("1.0.0")).toBe(true);
    expect(acceptsA2aPackageVersion("2.0.0")).toBe(false);
    expect(a2aResearchPackageForVersion("deep", "2.0.0")).toBeNull();
  });

  it("measures end-to-end latency and evidence quality without inventing a guarantee", () => {
    expect(
      completedA2aServiceReceipt({
        researchPackage: a2aResearchPackage("deep"),
        acceptedAt: "2026-09-02T00:00:00.000Z",
        startedAt: "2026-09-02T00:00:30.000Z",
        run,
      }),
    ).toMatchObject({
      outcome: "completed",
      queueDurationMs: 30_000,
      executionDurationMs: 210_000,
      totalDurationMs: 240_000,
      targetCompletionMs: 300_000,
      targetMet: true,
      objectiveKind: "provisional_slo",
      remedy: "none",
      quality: {
        status: "measured",
        claimCount: 2,
        measuredClaims: 2,
        groundedClaims: 1,
        groundedClaimRate: 0.5,
        qualifyingEvidence: 1,
        rewardedCitations: 1,
      },
      portableReceiptUrl: "/api/dispatch/a2a_result/receipt",
    });
  });

  it("marks incomplete quality telemetry unavailable and never calls failure an SLO success", () => {
    const incomplete = completedA2aServiceReceipt({
      researchPackage: a2aResearchPackage("deep"),
      acceptedAt: "2026-09-02T00:00:00.000Z",
      startedAt: "2026-09-02T00:00:30.000Z",
      run: { ...run, claimCoverage: [] },
    });
    expect(incomplete.quality).toMatchObject({
      status: "unavailable",
      groundedClaimRate: null,
    });

    expect(
      failedA2aServiceReceipt({
        researchPackage: a2aResearchPackage("quick"),
        acceptedAt: "2026-09-02T00:00:00.000Z",
        startedAt: null,
        finishedAt: "2026-09-02T00:01:00.000Z",
      }),
    ).toMatchObject({
      outcome: "failed",
      targetMet: false,
      queueDurationMs: null,
      executionDurationMs: null,
    });
  });

  it("exposes a deterministic pending deadline without calling it a contractual SLA", () => {
    expect(
      pendingA2aServiceStatus({
        researchPackage: a2aResearchPackage("quick"),
        state: "queued",
        acceptedAt: "2026-09-02T00:00:00.000Z",
        startedAt: null,
        nowMs: Date.parse("2026-09-02T00:03:00.001Z"),
      }),
    ).toMatchObject({
      targetCompletionAt: "2026-09-02T00:03:00.000Z",
      elapsedMs: 180_001,
      targetBreached: true,
      objectiveKind: "provisional_slo",
      remedy: "none",
    });
  });
});
