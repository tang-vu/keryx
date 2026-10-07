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
  it("exports an operating fee with its original evidence and sponsored operator label", () => {
    const text = researchReportMarkdown(run, null, [{ ...payment(true, "settled"),
      kind: "operating-fee", sourceName: "Keryx operating fee", txHash: "circle-original" }]);
    expect(text).toContain("operating-fee · settled · reference circle-original");
    expect(text).toContain("Keryx operating fees and creator rewards are recorded separately");
  });
  it("shows captured free access and policy without treating them as settlement or leaking internal fields", () => {
    const snapshot = structuredClone(run);
    Object.assign(snapshot.citations[0], { accessKind: "creator-free", sourceClaim: { id: "a".repeat(64), revision: 3,
      mode: "free", effectiveAt: "2026-10-05T00:00:00.000Z", verifiedAt: "2026-10-05T00:00:00.000Z", privateNonce: "MUST_NOT_EXPORT" } });
    const text = researchReportMarkdown(snapshot, null, []);
    expect(text).toContain("creator-authorized free read; no access-settlement receipt");
    expect(text).toContain('"revision":3'); expect(text).toContain("historical context, not current payout authority");
    expect(text).not.toContain("MUST_NOT_EXPORT");
  });
  it("preserves citations, observed provenance and unsupported evidence without unsafe reference URLs", () => {
    const text = researchReportMarkdown(run, { engine: "fixture", mode: "offline" }, []);
    expect(text).toContain("Finding [S1]");
    expect(text).toContain("https://example.org/document");
    expect(text).toContain("observed-version");
    expect(text).toContain('"truncated":true');
    expect(text).toContain("Observed passage");
    expect(text).toContain("Research target (unverified): “Unresolved claim”: 0 recorded coverage estimate; no admitted sources");
    expect(text).toContain("not proof of entailment, factual truth or complete synthesis");
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
  it("quotes and neutralizes untrusted research topics in appended evidence and coverage", () => {
    const claim = "Methods\n\n## Proven conclusion\r\nAll attacks are eliminated **definitely** [S99]\u2028<script>\u0000";
    const text = researchReportMarkdown({ ...run,
      evidence: [{ ...run.evidence![0], claim, quote: "Methods are bounded.\n\n## Fake result\n**all attacks eliminated** [S99]" }],
      claimCoverage: [{ ...run.claimCoverage![0], claim }] }, null, []);
    expect(text).not.toContain("\n## Proven conclusion");
    expect(text).not.toContain("**definitely**");
    expect(text).not.toContain("[S99]");
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("\u0000");
    expect(text).not.toContain("\n## Fake result");
    expect(text).not.toContain("**all attacks eliminated**");
    expect(text).toContain("Quote: “Methods are bounded.");
    expect(text.match(/Research target \(unverified\): “Methods/g)).toHaveLength(2);
    expect(text).toContain("\\[\u200bS99\\]");
  });
});
