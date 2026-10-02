import { describe, expect, it, vi } from "vitest";
import { demoteSyntheticEvidence, hasKnownSyntheticFingerprint, projectRecordedEvidenceProvenanceList } from "./evidence-provenance";
import { SEED_EVIDENCE_FINGERPRINTS } from "./seed-evidence-fingerprints";
import { SEED_SOURCES } from "../sources/seed-data";
import { contentBodyHash } from "../sources/content-receipt";
import { buildResearchReceipt, researchReceiptDigest, verifyResearchReceipt } from "../research-receipt";
import { exportsFromCheckedReceipt } from "./receipt-exports";
import type { QueryRun } from "../types";

function fixture(): QueryRun {
  const fingerprint = SEED_EVIDENCE_FINGERPRINTS.find(item => item.itemTitle === "Measuring x402 settlement latency on Arc")!;
  const identity = { itemId: "retained-item", contentVersion: "retained-version", itemTitle: fingerprint.itemTitle, itemUrl: fingerprint.itemUrl,
    contentReceipt: { bodyHash: fingerprint.bodyHash, deliveryKind: "abstract" as const, storageMode: "db_encrypted" as const, plaintextBytes: 123 } };
  return { id: "retained", question: "Measured latency", budget: 0.03, engine: "fixture", subClaims: ["Measured latency"], decisions: [],
    citations: [{ ...identity, marker: "S4", sourceId: "deleted-source", sourceName: "Renamed", weight: 1, reward: 0, rationale: "Retained citation" }],
    evidence: [{ ...identity, marker: "S4", sourceId: "deleted-source", sourceName: "Renamed", claimIndex: 0, claim: "Measured latency",
      quote: "measured median 178ms, p95 240ms", support: 0.9, qualifiesForAnswer: true, qualifiesForReward: true }],
    claimCoverage: [{ claimIndex: 0, claim: "Measured latency", coverage: 0.9, coveredBy: ["S4"] }],
    answer: "Latency median 178ms p95 240ms [S4]", totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-02", paymentMode: "real" };
}

describe("protective historical evidence projection", () => {
  it("preserves pre-evidence archive records without fabricating missing arrays or querying catalog metadata", async () => {
    const historical = { id: "old", question: "Before evidence records", answer: "Retained answer", totalSpent: 0.035 } as QueryRun;
    const resolve = vi.fn(async () => new Set<string>());
    expect(demoteSyntheticEvidence(historical)).toEqual(historical);
    expect(await projectRecordedEvidenceProvenanceList(resolve, [historical])).toEqual([historical]);
    expect(resolve).not.toHaveBeenCalled();
    expect(Object.hasOwn(demoteSyntheticEvidence(historical), "citations")).toBe(false);
    expect(Object.hasOwn(demoteSyntheticEvidence(historical), "decisions")).toBe(false);
  });
  it("keeps checked fingerprint manifest exactly matched to complete authored corpus", () => {
    expect(SEED_EVIDENCE_FINGERPRINTS).toEqual(SEED_SOURCES.flatMap(source => source.items ?? []).map(item => ({ itemTitle: item.title, itemUrl: item.link, bodyHash: contentBodyHash(item.content) })));
  });
  it("demotes exact immutable corpus fingerprints even after catalog deletion, never labels by URL/title alone", () => {
    const run = fixture();
    expect(demoteSyntheticEvidence(run).answer).toContain("Illustrative demo content");
    expect(run.answer).not.toContain("Illustrative demo content");
    expect(hasKnownSyntheticFingerprint({ ...run.citations[0], contentReceipt: undefined })).toBe(false);
    expect(hasKnownSyntheticFingerprint({ ...run.citations[0], itemTitle: "Different title" })).toBe(false);
    expect(hasKnownSyntheticFingerprint({ ...run.citations[0], contentReceipt: { ...run.citations[0].contentReceipt!, bodyHash: "0xwrong" } })).toBe(false);
  });
  it("labels derived old receipt exports after integrity checking without changing original receipt bytes or digest", () => {
    // Build an old-shape receipt manually from a factual fixture then attach the exact archived
    // identity before sealing; the runtime builder now demotes known fingerprints by design.
    const run = fixture(), identity = run.citations[0];
    const temporary = { ...run, citations: [{ ...identity, contentReceipt: undefined }], evidence: [] };
    const receipt = buildResearchReceipt(temporary, []);
    receipt.payload.citations[0].contentReceipt = identity.contentReceipt;
    // A historical receipt's digest was produced before classification; preserve that authority.
    receipt.integrity.digest = researchReceiptDigest(receipt.payload);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    const original = JSON.stringify(receipt);
    const exports = exportsFromCheckedReceipt(receipt);
    expect(exports.bibtex.content).toContain("ILLUSTRATIVE SYNTHETIC DEMO");
    expect(JSON.stringify(receipt)).toBe(original);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
  });
  it("shares one deduplicated metadata-only lookup per history page", async () => {
    const run = fixture(); delete run.citations[0].contentReceipt; delete run.evidence![0].contentReceipt;
    const resolve = vi.fn(async () => new Set(["item:deleted-source:retained-item"]));
    const projected = await projectRecordedEvidenceProvenanceList(resolve, [run, { ...run, id: "other" }]);
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ sourceIds: ["deleted-source"], itemIds: ["retained-item"] });
    expect(projected.every(item => item.answer.includes("Illustrative demo content"))).toBe(true);
    expect(projected[0].claimCoverage?.[0]).toMatchObject({ coverage: 0, coveredBy: [] });
  });
});
