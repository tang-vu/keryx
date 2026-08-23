import { describe, expect, it } from "vitest";
import type { Decision } from "../types";
import {
  buildPreviewCoverage,
  normalizeClaimTargets,
  previewCoverageBlockReason,
} from "./coverage-precheck";

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    sourceId: "source-1",
    sourceName: "Source 1",
    action: "BUY",
    expectedValue: 0.7,
    price: 0.002,
    confidence: 0.8,
    rationale: "relevant preview",
    targets: [0],
    ...overrides,
  };
}

describe("preview coverage pre-check", () => {
  it("normalizes only real claim indexes", () => {
    expect(normalizeClaimTargets([2, 0, 2, -1, 4, 1.5], 3)).toEqual([0, 2]);
  });

  it("reports partial coverage from actionable preview decisions", () => {
    const result = buildPreviewCoverage(
      ["claim one", "claim two"],
      [decision({ targets: [0] }), decision({ sourceId: "weak", targets: [1], expectedValue: 0.1 })],
    );
    expect(result).toMatchObject({ status: "partial", coveredClaims: 1, totalClaims: 2, ratio: 0.5 });
    expect(result.claims[0]?.candidateIds).toEqual(["source-1"]);
    expect(result.claims[1]?.candidateIds).toEqual([]);
  });

  it("blocks only untargeted or low-value paid reads", () => {
    expect(previewCoverageBlockReason(decision({ targets: [] }), 2)).toMatch(/could not connect/);
    expect(previewCoverageBlockReason(decision({ expectedValue: 0.05 }), 2)).toMatch(/spend floor/);
    expect(previewCoverageBlockReason(decision(), 2)).toBeNull();
    expect(previewCoverageBlockReason(decision({ action: "SKIP", targets: [] }), 2)).toBeNull();
  });
});
