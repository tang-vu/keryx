import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { RESEARCH_RECEIPT_SCHEMA } from "../research-receipt-types";
import { compareSavedResearch } from "./report-comparison";
import { exportReportComparison } from "./report-comparison-export";
import { COMPARISON_FILTERS, filterComparisonTargets, indexComparisonTargets } from "./report-comparison-view";

function receipt(after = false) {
  const citation = { marker: "S1", sourceId: "source:manual", sourceName: "Café API", itemId: "buffer",
    itemTitle: "Buffer lifetime", itemUrl: "https://example.test/api#buffer", contentVersion: "v7" };
  const evidence = (quote: string, truncated = false) => [{ ...citation, quote, qualifiesForAnswer: true,
    qualifiesForReward: false, webProvenance: { extraction: "text", truncated } }];
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { id: after ? "after" : "before", answer: "Not searchable outside a target" },
    citations: [citation], claims: [
      { claimIndex: 0, claim: "Unchanged target", evidence: evidence("Stable literal [x].*") },
      { claimIndex: 1, claim: "Changed target", evidence: evidence(after ? "New lifetime" : "Old lifetime") },
      { claimIndex: 2, claim: "Context target", evidence: evidence("Same excerpt", after) },
      { claimIndex: 3, claim: "Empty target", evidence: [] },
      { claimIndex: 4, claim: "Unknown ledger" },
      { claimIndex: 5, claim: after ? "New unmatched target" : "Old unmatched target", evidence: evidence("Still retained") },
      { claimIndex: 6, claim: "Now empty", evidence: after ? [] : evidence("Retained only before") },
    ] };
  return JSON.stringify({ payload, integrity: { algorithm: "sha256", canonicalization: "keryx-json-v1", scope: "payload",
    digest: `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}` } });
}

describe("saved report comparison navigation", () => {
  it("keeps unknown and unmatched targets distinct from recorded changes, with overlapping evidence gaps", async () => {
    const comparison = await compareSavedResearch({ before: receipt(), after: receipt(true) });
    const index = indexComparisonTargets(comparison);
    const positions = (filter: typeof COMPARISON_FILTERS[number]) => filterComparisonTargets(index, filter, "").map(row => row.index);
    expect(positions("all")).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(positions("changes")).toEqual([1, 2, 6]);
    expect(positions("gaps")).toEqual([3, 4, 6]);
    expect(positions("unmatched")).toEqual([5, 7]);
    expect(filterComparisonTargets(index, "changes", "stable")).toEqual([]);
    expect(filterComparisonTargets(index, "changes", "LIFETIME").map(row => row.index)).toEqual([1, 2, 6]);
  });

  it("searches both sides literally and by canonical Unicode without searching unrelated report fields", async () => {
    const index = indexComparisonTargets(await compareSavedResearch({ before: receipt(), after: receipt(true) }));
    for (const term of ["  CAFÉ  ", "Cafe\u0301", "SOURCE:MANUAL", "buffer", "api#buffer", "v7", "S1"])
      expect(filterComparisonTargets(index, "all", term).length, term).toBeGreaterThan(0);
    expect(filterComparisonTargets(index, "all", "old lifetime").map(row => row.index)).toEqual([1]);
    expect(filterComparisonTargets(index, "all", "new lifetime").map(row => row.index)).toEqual([1]);
    expect(filterComparisonTargets(index, "all", "[x].*").map(row => row.index)).toEqual([0]);
    expect(filterComparisonTargets(index, "all", "[x].+" )).toEqual([]);
    expect(filterComparisonTargets(index, "all", "not searchable")).toEqual([]);
    expect(filterComparisonTargets(index, "all", "Unknown ledger").map(row => row.index)).toEqual([4]);
    expect(filterComparisonTargets(index, "all", "  ")).toHaveLength(index.length);
  });

  it("preserves the full artifact, totals, exports and stable target identity through every view", async () => {
    const comparison = await compareSavedResearch({ before: receipt(), after: receipt(true) });
    const original = JSON.stringify(comparison);
    const exports = ["json", "markdown", "csv"].map(format => exportReportComparison(comparison, format as "json" | "markdown" | "csv"));
    const index = indexComparisonTargets(comparison);
    for (const filter of COMPARISON_FILTERS) for (const query of ["", "target", "nothing matches"]) {
      for (const row of filterComparisonTargets(index, filter, query)) expect(row.target).toBe(comparison.targets[row.index]);
    }
    expect(JSON.stringify(comparison)).toBe(original);
    expect(["json", "markdown", "csv"].map(format => exportReportComparison(comparison, format as "json" | "markdown" | "csv"))).toEqual(exports);
  });
});
