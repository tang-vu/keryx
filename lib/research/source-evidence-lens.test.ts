import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../types";
import type { EvidenceMatrixInput } from "./evidence-matrix";
import { buildSourceEvidenceLens } from "./source-evidence-lens";
import { SEED_EVIDENCE_FINGERPRINTS } from "./seed-evidence-fingerprints";

const excerpt = (sourceId: string, claimIndex = 0, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  claimIndex, claim: ["Export data?", "Audit log?", "Support terms?"][claimIndex], marker: sourceId,
  sourceId, sourceName: `Source ${sourceId}`, itemId: `${sourceId}-article`, contentVersion: "v1",
  quote: `Recorded excerpt from ${sourceId}.`, support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false, ...overrides,
});
const fixture = (): EvidenceMatrixInput => ({ subClaims: ["Export data?", "Audit log?", "Support terms?", "Already missing?"],
  citations: ["A", "B", "C"].map(sourceId => ({ marker: sourceId, sourceId, sourceName: `Source ${sourceId}`,
    itemId: `${sourceId}-article`, contentVersion: "v1", weight: 0, reward: 0, rationale: "" })),
  evidence: [excerpt("A"), excerpt("B"), excerpt("A", 1), excerpt("C", 2)],
});

describe("source excerpt inspection", () => {
  it("distinguishes a newly lost last excerpt from gaps already present", () => {
    const run = fixture(), original = JSON.stringify(run);
    const view = buildSourceEvidenceLens(run, "A");
    expect(view.newlyMissingTargets).toBe(1);
    expect(view.alreadyMissingTargets).toBe(1);
    expect(view.rows.map(row => row.state)).toEqual(["retained", "lost-last-excerpt", "retained", "already-missing"]);
    expect(view.rows[0].remaining.map(item => item.sourceId)).toEqual(["B"]);
    expect(JSON.stringify(run)).toBe(original);
    expect(buildSourceEvidenceLens(run).rows.map(row => row.remaining.length)).toEqual([2, 1, 1, 0]);
  });
  it("never calls missing legacy data an empty ledger or a loss", () => {
    const view = buildSourceEvidenceLens({ ...fixture(), evidence: undefined }, "A");
    expect(view.available).toBe(false);
    expect(view.rows.every(row => row.state === "unavailable")).toBe(true);
    expect(view.newlyMissingTargets).toBe(0);
    expect(view.alreadyMissingTargets).toBe(0);
    expect(view.sources).toEqual([]);
  });
  it("normalizes a foreign or no-longer-inspectable selection to the original view", () => {
    expect(buildSourceEvidenceLens(fixture(), "foreign")).toEqual(buildSourceEvidenceLens(fixture()));
    const run = fixture(); run.evidence = run.evidence!.filter(item => item.sourceId !== "A");
    expect(buildSourceEvidenceLens(run, "A").omittedSourceId).toBeNull();
  });
  it.each([{ qualifiesForAnswer: false, qualifiesForReward: true }, { marker: "foreign" }, { claim: "different target" },
    { contentVersion: "v2" }, { itemId: "another article" }, { sourceId: "foreign" }, { quote: "x".repeat(241) }, { quote: " " }])(
    "excludes rejected or inconsistent evidence %j", overrides => {
      const run = fixture(); run.evidence = [excerpt("A", 1, overrides)];
      expect(buildSourceEvidenceLens(run).sources).toEqual([]);
      expect(buildSourceEvidenceLens(run).rows[1].state).toBe("already-missing");
    },
  );
  it("uses legacy reward qualification only when answer qualification is absent", () => {
    const run = fixture(); run.evidence = [excerpt("A", 0, { qualifiesForAnswer: undefined, qualifiesForReward: true })];
    expect(buildSourceEvidenceLens(run).sources.map(source => source.sourceId)).toEqual(["A"]);
  });
  it("omits synthetic evidence and all records sharing a synthetic marker", () => {
    const run = fixture(); run.evidence!.push(excerpt("A", 2, { evidenceProvenance: "synthetic-demo" }));
    expect(buildSourceEvidenceLens(run).sources.map(source => source.sourceId)).toEqual(["B", "C"]);
    const citedDemo = fixture(); citedDemo.citations[0].evidenceProvenance = "synthetic-demo";
    expect(buildSourceEvidenceLens(citedDemo).sources.map(source => source.sourceId)).toEqual(["B", "C"]);
  });
  it("deduplicates the same asset excerpt without merging distinct versions", () => {
    const run = fixture(); run.evidence!.push({ ...run.evidence![0] });
    expect(buildSourceEvidenceLens(run).rows[0].originalExcerpts).toBe(2);
    run.citations.push({ ...run.citations[0], contentVersion: "v2" });
    run.evidence!.push(excerpt("A", 0, { contentVersion: "v2" }));
    const view = buildSourceEvidenceLens(run, "A");
    expect(view.rows[0].originalExcerpts).toBe(3);
    expect(view.rows[0].remaining).toHaveLength(1);
    expect(view.rows[0].remaining[0].sourceId).toBe("B");
  });
  it("protects a known seed identity even when its demo label was not retained", () => {
    const run = fixture(), fingerprint = SEED_EVIDENCE_FINGERPRINTS[0];
    run.evidence![0] = { ...run.evidence![0], itemTitle: fingerprint.itemTitle, itemUrl: fingerprint.itemUrl,
      contentReceipt: { bodyHash: fingerprint.bodyHash } as EvidenceRecord["contentReceipt"] };
    expect(buildSourceEvidenceLens(run).sources.map(source => source.sourceId)).toEqual(["B", "C"]);
  });
  it("does not make an empty source identity selectable", () => {
    const run = fixture();
    run.citations = [{ ...run.citations[0], sourceId: "" }];
    run.evidence = [excerpt("A", 0, { sourceId: "" })];
    expect(buildSourceEvidenceLens(run).sources).toEqual([]);
  });
  it("recovers target names from the retained ledger when decomposition is absent", () => {
    const run = fixture(); run.subClaims = [];
    expect(buildSourceEvidenceLens(run).rows.map(row => row.claim)).toEqual(["Export data?", "Audit log?", "Support terms?"]);
  });
  it("does not derive excerpt authority from coverage or a source name alone", () => {
    const run = fixture(); run.evidence = [];
    run.claimCoverage = [{ claimIndex: 0, claim: "Export data?", coverage: 1, coveredBy: ["A"] }];
    expect(buildSourceEvidenceLens(run, "A").sources).toEqual([]);
    expect(buildSourceEvidenceLens(run).rows.every(row => row.state === "already-missing")).toBe(true);
  });
});
