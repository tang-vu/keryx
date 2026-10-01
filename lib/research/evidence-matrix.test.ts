import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../types";
import { buildEvidenceMatrix, evidenceCsvCell, evidenceMatrixCsv, type EvidenceMatrixInput } from "./evidence-matrix";

const evidence: EvidenceRecord = { claimIndex: 0, claim: "Market size?", marker: "S1", sourceId: "one",
  sourceName: "Publication", quote: 'Exact "quoted" evidence\n第二行', support: 0.8, qualifiesForReward: true };
const run: EvidenceMatrixInput = { subClaims: ["Market size?", "Pricing?"], evidence: [evidence],
  citations: [{ marker: "S1", sourceId: "one", sourceName: "Publication", weight: 1, reward: 0, rationale: "" }] };

describe("research evidence matrix", () => {
  it("retains exact excerpts and marks inspection gaps without deriving verdicts from coverage", () => {
    const rows = buildEvidenceMatrix({ ...run, claimCoverage: [{ claimIndex: 1, claim: "Pricing?", coverage: 1, coveredBy: ["S1"] }] });
    expect(rows[0].evidence[0].quote).toBe(evidence.quote);
    expect(rows[1].status).toBe("No inspectable excerpt recorded");
    expect(buildEvidenceMatrix({ ...run, evidence: undefined })[0].status).toBe("Evidence ledger unavailable");
  });
  it("excludes uncited, rejected, mismatched, and overlong excerpts", () => {
    for (const override of [{ qualifiesForReward: false }, { sourceId: "wrong" }, { marker: "S9" }, { claim: "wrong" },
      { itemId: "different-article" }, { contentVersion: "different-version" }, { quote: "x".repeat(241) }]) {
      expect(buildEvidenceMatrix({ ...run, evidence: [{ ...evidence, ...override }] })[0].evidence).toEqual([]);
    }
  });
  it("includes answer-qualified public evidence without reward authority and honors explicit rejection", () => {
    const publicCitation = { ...run.citations[0], sourceKind: "public-reference" as const, reward: 0 };
    const publicEvidence = { ...evidence, qualifiesForAnswer: true, qualifiesForReward: false };
    const publicRun = { ...run, citations: [publicCitation], evidence: [publicEvidence] };
    expect(buildEvidenceMatrix(publicRun)[0].evidence).toEqual([publicEvidence]);
    expect(evidenceMatrixCsv(publicRun)).toContain('"Recorded excerpt"');
    expect(buildEvidenceMatrix({ ...publicRun, evidence: [{ ...publicEvidence, qualifiesForAnswer: false, qualifiesForReward: true }] })[0].evidence).toEqual([]);
  });
  it("retains exact article identities and keeps versions separate for the same marker and source", () => {
    const versions = ["v1", "v2"];
    const versioned = { ...run,
      evidence: versions.map((contentVersion) => ({ ...evidence, itemId: "article", contentVersion })),
      citations: versions.map((contentVersion) => ({ ...run.citations[0], itemId: "article", contentVersion })),
    };
    expect(buildEvidenceMatrix(versioned)[0].evidence.map((item) => item.contentVersion)).toEqual(versions);
    const csv = evidenceMatrixCsv(versioned);
    expect(csv).toContain('"item_id","content_version"');
    expect(csv).toContain('"article","v1"');
    expect(csv).toContain('"article","v2"');
    expect(buildEvidenceMatrix({ ...versioned, citations: [versioned.citations[0]] })[0].evidence).toHaveLength(1);
  });
  it("recovers stored claim names when legacy decomposition is absent", () => {
    expect(buildEvidenceMatrix({ ...run, subClaims: [] })[0].claim).toBe("Market size?");
  });
  it("quotes multiline Unicode and double quotes while exposing no unapproved body", () => {
    const csv = evidenceMatrixCsv(run);
    expect(csv).toContain('"Exact ""quoted"" evidence\n第二行"');
    expect(csv).toContain('"Not recorded"');
    expect(csv).toContain('"Pricing?","No inspectable excerpt recorded"');
  });
  it("neutralizes formulas after whitespace, controls, and formatting characters", () => {
    for (const value of ["=1+1", "+SUM(A1)", "-1+1", "@SUM(A1)", " \t\r\n=1", "\u0000=1", "\u200b=1"]) {
      expect(evidenceCsvCell(value)).toBe(`"'${value}"`);
    }
    expect(evidenceCsvCell("普通 text")).toBe('"普通 text"');
  });
});
