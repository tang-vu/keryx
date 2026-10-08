import { describe, expect, it } from "vitest";

import type { Decision } from "../types";
import {
  attachEvidencePortfolioOutcome,
  selectEvidencePortfolio,
} from "./evidence-portfolio";

function decision(
  id: string,
  action: Decision["action"],
  expectedValue: number,
  price: number,
  targets: number[],
): Decision {
  return {
    sourceId: id,
    assetId: `item:${id}`,
    sourceName: id,
    action,
    expectedValue,
    price,
    confidence: 0.9,
    rationale: `${action} ${id}`,
    targets,
  };
}

describe("claim-aware evidence portfolio", () => {
  it("chooses one free public channel for equal public/paid document aliases without corroboration inflation", () => {
    const rows = [
      { ...decision("registered", "BUY", 0.95, 0.002, [0]), itemUrl: "https://publisher.test/article" },
      { ...decision("public", "CACHE", 0.95, 0, [0]), itemUrl: "https://publisher.test/article#section", sourceKind: "public-reference" as const },
      { ...decision("independent", "CACHE", 0.7, 0, [1]), itemUrl: "https://other.test/article" },
    ];
    const input = { decisions: rows, claimCount: 2, attentionLimit: 2, fetchBudgetUsdc: 0.025 };
    const selected = selectEvidencePortfolio(input);
    expect(selected).toEqual(selectEvidencePortfolio({ ...input, decisions: [...rows].reverse() }));
    expect(selected.selectedAssetIds).toEqual(["item:public", "item:independent"]);
    expect(selected.selectedBuyUsdc).toBe(0);
    expect(selected.claims.map(claim => claim.predictedCoverage)).toEqual([0.95, 0.7]);
  });

  it("keeps a stronger registered channel's own price and targets without borrowing public coverage", () => {
    const result = selectEvidencePortfolio({ decisions: [
      { ...decision("registered", "BUY", 0.9, 0.002, [0]), itemUrl: "https://publisher.test/article" },
      { ...decision("public", "CACHE", 0.5, 0, [1]), itemUrl: "https://publisher.test/article", sourceKind: "public-reference" as const },
    ], claimCount: 2, attentionLimit: 2, fetchBudgetUsdc: 0.01 });
    expect(result.selectedAssetIds).toEqual(["item:registered"]);
    expect(result.selectedBuyUsdc).toBe(0.002);
    expect(result.claims.map(claim => claim.predictedCoverage)).toEqual([0.9, 0]);
  });

  it("prefers public over a paid cache alias only on an equivalent document and utility", () => {
    const result = selectEvidencePortfolio({ decisions: [
      { ...decision("registered-cache", "CACHE", 0.8, 0.002, [0]), itemUrl: "https://publisher.test/article" },
      { ...decision("public", "CACHE", 0.8, 0, [0]), itemUrl: "https://publisher.test/article", sourceKind: "public-reference" as const },
    ], claimCount: 1, attentionLimit: 2, fetchBudgetUsdc: 0 });
    expect(result.selectedAssetIds).toEqual(["item:public"]);
    expect(result.claims[0].predictedCoverage).toBe(0.8);
  });

  it("keeps cached-alias tie ranking deterministic with interleaved independent candidates", () => {
    const rows = [
      { ...decision("a-registered", "CACHE", 0.8, 0.002, [0]), itemUrl: "https://publisher.test/article" },
      { ...decision("z-public", "CACHE", 0.8, 0, [0]), itemUrl: "https://publisher.test/article", sourceKind: "public-reference" as const },
      { ...decision("m-independent", "CACHE", 0.8, 0, [0]), itemUrl: "https://other.test/article" },
    ];
    const select = (decisions: Decision[]) => selectEvidencePortfolio({ decisions, claimCount: 1,
      attentionLimit: 2, fetchBudgetUsdc: 0 });
    const result = select(rows);
    expect(result).toEqual(select([...rows].reverse()));
    expect(result).toEqual(select([rows[1], rows[2], rows[0]]));
    expect(result.selectedAssetIds).toContain("item:z-public");
    expect(result.selectedAssetIds).toContain("item:m-independent");
  });

  it("leaves bounded optimization room for independent documents before dozens of aliases", () => {
    const aliases = Array.from({ length: 50 }, (_, index) => ({
      ...decision(`alias-${index}`, "CACHE", 0.95, 0, [0]), itemUrl: "https://publisher.test/article",
    }));
    const result = selectEvidencePortfolio({ decisions: [...aliases,
      { ...decision("independent", "CACHE", 0.7, 0, [1]), itemUrl: "https://other.test/article" },
    ], claimCount: 2, attentionLimit: 2, fetchBudgetUsdc: 0 });
    expect(result.selectedAssetIds).toContain("item:independent");
    expect(result.selectedAssetIds).toHaveLength(2);
    expect(result.claims[0].predictedCoverage).toBe(0.95);
  });

  it("bounds broad-catalog work deterministically without enlarging money or attention caps", () => {
    const rows = Array.from({ length: 48 }, (_, index) => decision(String(index), "BUY", 0.8, 0.001, [index % 8]));
    const input = { decisions: rows, claimCount: 8, attentionLimit: 8, fetchBudgetUsdc: 0.005 };
    const result = selectEvidencePortfolio(input), reversed = selectEvidencePortfolio({ ...input, decisions: [...rows].reverse() });
    expect(result).toEqual(reversed); expect(result.selectionMethod).toBe("bounded-heuristic"); expect(result.evaluatedStates).toBeLessThanOrEqual(20000);
    expect(result.selectedBuyUsdc).toBeLessThanOrEqual(0.005); expect(result.selectedAssetIds.length).toBeLessThanOrEqual(8);
  });
  it("does not let a CACHE entry's list price crowd out the strongest exact evidence", () => {
    const result = selectEvidencePortfolio({
      decisions: [
        decision("exact", "CACHE", 0.88, 0.004, [0, 1, 2]),
        decision("cheap-generic", "CACHE", 0.8, 0.002, [0, 1, 2]),
        decision("cheaper-generic", "CACHE", 0.7, 0.001, [0, 1, 2]),
      ],
      claimCount: 3,
      attentionLimit: 2,
      fetchBudgetUsdc: 0.025,
    });

    expect(result.selectedAssetIds).toEqual(["item:exact", "item:cheap-generic"]);
    expect(result.selectedBuyUsdc).toBe(0);
    expect(result.predictedCoveredClaims).toBe(3);
  });

  it("covers a missing claim instead of filling attention with redundant high-EV sources", () => {
    const result = selectEvidencePortfolio({
      decisions: [
        decision("claim-a-best", "CACHE", 0.95, 0.002, [0]),
        decision("claim-a-copy", "CACHE", 0.9, 0.001, [0]),
        decision("claim-b", "CACHE", 0.7, 0.01, [1]),
      ],
      claimCount: 2,
      attentionLimit: 2,
      fetchBudgetUsdc: 0,
    });

    expect(result.selectedAssetIds).toEqual(["item:claim-a-best", "item:claim-b"]);
    expect(result.claims.map((claim) => claim.predictedCoverage)).toEqual([0.95, 0.7]);
  });

  it("counts CACHE as zero fetch spend while keeping BUY under the authoritative cap", () => {
    const result = selectEvidencePortfolio({
      decisions: [
        decision("buy-a", "BUY", 0.9, 0.02, [0]),
        decision("buy-b", "BUY", 0.8, 0.02, [1]),
        decision("cached-b", "CACHE", 0.7, 99, [1]),
      ],
      claimCount: 2,
      attentionLimit: 2,
      fetchBudgetUsdc: 0.025,
    });

    expect(result.selectedAssetIds).toEqual(["item:buy-a", "item:cached-b"]);
    expect(result.selectedBuyUsdc).toBe(0.02);
    expect(result.unusedFetchBudgetUsdc).toBe(0.005);
  });

  it("floors fractional-micro fetch authority instead of rounding it up", () => {
    const result = selectEvidencePortfolio({
      decisions: [decision("one-micro", "BUY", 0.9, 0.000001, [0])],
      claimCount: 1,
      attentionLimit: 1,
      fetchBudgetUsdc: 0.0000005,
    });

    expect(result.fetchBudgetUsdc).toBe(0);
    expect(result.selectedAssetIds).toEqual([]);
    expect(result.selectedBuyUsdc).toBe(0);
  });

  it("never promotes a model SKIP into the spendable portfolio", () => {
    const result = selectEvidencePortfolio({
      decisions: [
        decision("skip-me", "SKIP", 1, 0, [0]),
        decision("buy-me", "BUY", 0.5, 0.002, [0]),
      ],
      claimCount: 1,
      attentionLimit: 2,
      fetchBudgetUsdc: 0.01,
    });

    expect(result.eligibleCandidates).toBe(1);
    expect(result.selectedAssetIds).toEqual(["item:buy-me"]);
  });

  it("rejects positive proposals that target no claim in the current plan", () => {
    const result = selectEvidencePortfolio({
      decisions: [
        decision("out-of-range", "BUY", 1, 0.002, [4]),
        decision("valid", "CACHE", 0.6, 0.001, [0]),
      ],
      claimCount: 1,
      attentionLimit: 2,
      fetchBudgetUsdc: 0.01,
    });

    expect(result.eligibleCandidates).toBe(1);
    expect(result.selectedAssetIds).toEqual(["item:valid"]);
  });

  it("is input-order invariant", () => {
    const decisions = [
      decision("z", "BUY", 0.75, 0.003, [0]),
      decision("a", "CACHE", 0.65, 0.5, [1]),
      decision("m", "BUY", 0.7, 0.002, [0, 1]),
    ];
    const select = (items: Decision[]) =>
      selectEvidencePortfolio({
        decisions: items,
        claimCount: 2,
        attentionLimit: 2,
        fetchBudgetUsdc: 0.004,
      });

    expect(select(decisions)).toEqual(select([...decisions].reverse()));
  });

  it("stops adding redundant context after marginal evidence falls below attention cost", () => {
    const result = selectEvidencePortfolio({
      decisions: [
        decision("a", "CACHE", 0.8, 0.001, [0]),
        decision("b", "CACHE", 0.7, 0.001, [0]),
        decision("c", "CACHE", 0.6, 0.001, [0]),
        decision("d", "CACHE", 0.5, 0.001, [0]),
      ],
      claimCount: 1,
      attentionLimit: 4,
      fetchBudgetUsdc: 0,
    });

    expect(result.selectedAssetIds).toEqual(["item:a", "item:b"]);
  });

  it("records read-to-evidence yield without treating it as settlement authority", () => {
    const portfolio = selectEvidencePortfolio({
      decisions: [
        decision("a", "CACHE", 0.8, 0.001, [0]),
        decision("b", "CACHE", 0.7, 0.001, [1]),
      ],
      claimCount: 2,
      attentionLimit: 2,
      fetchBudgetUsdc: 0,
    });
    const withOutcome = attachEvidencePortfolioOutcome(portfolio, {
      read: [
        { assetId: "item:a", sourceId: "a", marker: "S1" },
        { assetId: "item:b", sourceId: "b", marker: "S2" },
        { assetId: "item:later", sourceId: "later", marker: "S3" },
      ],
      acceptedMarkers: new Set(["S1", "S3"]),
      groundedClaims: 1,
    });

    expect(withOutcome.outcome).toEqual({
      readAssetIds: ["item:a", "item:b"],
      evidenceAssetIds: ["item:a"],
      nonqualifyingReads: 1,
      unreadSelected: 0,
      groundedClaims: 1,
      evidenceYield: 0.5,
    });
  });
});
