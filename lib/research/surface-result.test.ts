import { buildResearchReceipt } from "../research-receipt";
import { exportsFromCheckedReceipt } from "./receipt-exports";
import { describe, expect, it } from "vitest";
import { a2aResponseFromRun } from "../a2a/result";
import { quoteA2aResearch } from "../a2a/pricing";
import { keryxMeta } from "../openai-compat";
import { remoteResearchResult } from "../mcp/remote-server";
import type { QueryRun } from "../types";
import { surfaceResearch } from "./surface-result";

export function fixture(): QueryRun {
  const identity = { sourceKind: "public-reference" as const, itemId: "article-1", itemTitle: "Observed paper",
    itemUrl: "https://example.org/paper", contentVersion: "sha256:observed" };
  return { id: "run", question: "Question?", budget: 0.03, engine: "heuristic", answer: "Evidence [P1]",
    subClaims: ["Recorded claim"], decisions: [], citations: [{ ...identity, marker: "P1", sourceId: "public:paper",
      sourceName: "Publisher", weight: 1, reward: 0, rationale: "Actual public evidence" }],
    evidence: [{ ...identity, claimIndex: 0, claim: "Recorded claim", marker: "P1", sourceId: "public:paper",
      sourceName: "Publisher", quote: "Exact original quote", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false }],
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-01T00:00:00Z", paymentMode: "real" };
}

describe("research surface parity", () => {
  it("retains public article identity, answer evidence and reusable exports on all transports", () => {
    const run = fixture();
    for (const result of [surfaceResearch(run), remoteResearchResult(run), keryxMeta(run),
      a2aResponseFromRun(run, quoteA2aResearch(0.03, "deep"))]) {
      expect(result.citations[0]).toMatchObject({ marker: "P1", itemUrl: "https://example.org/paper", rewardPlannedUsdc: 0 });
      expect(result.evidence[0]).toMatchObject({ qualifiesForAnswer: true, qualifiesForReward: false, itemId: "article-1" });
      expect(result.researchExports.bibtex.count).toBe(1);
      expect(result.researchExports.ris.content).toContain("TI  - Observed paper");
      expect(result.researchExports.evidenceCsv).toContain("Exact original quote");
      expect(result.creatorsPaid).toBeNull();
      expect(result.creatorRewardAllocations).toBe(0);
      expect(result.creatorsReferenced).toBe(1);
    }
  });

  it("matches actual receipt-derived scholarly exports without enrichment", () => {
    const run = fixture();
    run.citations[0].scholarly = { provider: "crossref", recordUrl: "https://api.crossref.org/works/10.1234/example", retrievedAt: run.createdAt, title: "Observed paper", authors: ["Recorded Author"], workType: "journal-article", peerReview: "unknown", doi: "10.1234/example", evidenceScope: "publisher-page" };
    const receipt = buildResearchReceipt(run, []);
    expect(exportsFromCheckedReceipt(receipt)).toEqual(surfaceResearch(run).researchExports);
    expect(exportsFromCheckedReceipt(receipt).bibtex.content).toContain("10.1234/example");
  });

  it("refuses mismatched and unbounded excerpts and strips unexpected internal fields", () => {
    const run = fixture();
    run.evidence = [run.evidence![0], { ...run.evidence![0], contentVersion: "other" },
      { ...run.evidence![0], itemId: "other" }, { ...run.evidence![0], quote: "x".repeat(241) }];
    Object.assign(run.citations[0], { privateKey: "secret", plaintext: "gated body" });
    Object.assign(run.evidence[0], { privateKey: "secret" });
    const result = surfaceResearch(run);
    expect(result.evidence).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/secret|gated body|privateKey/);
  });
});
