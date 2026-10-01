import { describe, expect, it } from "vitest";
import { researchReportFilename, researchReportMarkdown } from "./research-report-export";
import type { PaymentRecord, QueryRun } from "./types";

const run = {
  id: "report", question: "Question", budget: 0.05, answer: "Finding [S1].",
  citations: [{ marker: "S1", sourceName: "Original document", itemUrl: "https://example.org/document", contentVersion: "observed-version", webProvenance: { retrievedAt: "2026-10-01", truncated: true } }, { marker: "S2", sourceName: "Unsafe", itemUrl: "javascript:alert(1)" }],
  evidence: [{ marker: "S1", claim: "Claim", quote: "Observed passage", qualifiesForAnswer: true, qualifiesForReward: false }],
  claimCoverage: [{ claim: "Unresolved claim", coverage: 0, coveredBy: [] }],
} as unknown as QueryRun;
const payment = (settled: boolean, settlementStatus?: PaymentRecord["settlementStatus"]) => ({ sourceName: "Writer", amountUsdc: 0.001, kind: "citation", settled, settlementStatus } as PaymentRecord);

describe("research report export", () => {
  it("preserves citations, observed provenance and unsupported evidence without unsafe reference URLs", () => {
    const text = researchReportMarkdown(run, { engine: "fixture", mode: "offline" }, []);
    expect(text).toContain("Finding [S1]");
    expect(text).toContain("https://example.org/document");
    expect(text).toContain("observed-version");
    expect(text).toContain('"truncated":true');
    expect(text).toContain("Observed passage");
    expect(text).toContain("Unresolved claim: 0 coverage; no admitted sources");
    expect(text).not.toContain("javascript:");
    expect(text).toContain("Mode: offline");
  });
  it("keeps pending, simulation, conflicting records and legacy settlement distinct", () => {
    const text = researchReportMarkdown(run, null, [payment(false, "pending"), payment(false, "simulated"), payment(false, "settled"), payment(true, "simulated"), payment(true), payment(false)]);
    expect(text.match(/· pending/g)).toHaveLength(1);
    expect(text.match(/· simulated/g)).toHaveLength(1);
    expect(text.match(/· unverified/g)).toHaveLength(3);
    expect(text.match(/· settled/g)).toHaveLength(1);
    expect(text).toContain("A citation alone does not prove settlement");
  });
  it("bounds a filesystem-safe download name", () => {
    expect(researchReportFilename("../../x\n/secret")).toBe("keryx-report-xsecret.md");
    expect(researchReportFilename("/")).toBe("keryx-report-research.md");
    expect(researchReportFilename("x".repeat(100))).toHaveLength(80);
  });
});
