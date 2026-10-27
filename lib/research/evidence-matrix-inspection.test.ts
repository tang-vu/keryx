import { describe, expect, it } from "vitest";
import { buildEvidenceMatrix, type EvidenceMatrixInput } from "./evidence-matrix";
import { inspectEvidenceMatrix, matrixSourceIdentity, type MatrixInspectionFilters } from "./evidence-matrix-inspection";

const first = { marker: "S1", sourceId: "publisher", sourceName: "Nhà xuất bản", itemId: "article", itemTitle: "Đám mây",
  itemUrl: "https://example.test/article?v=1", contentVersion: "v1", weight: 1, reward: 0, rationale: "Fixture" };
const second = { ...first, itemUrl: "https://example.test/article?v=2" };
const versioned = { ...first, contentVersion: "v2" };
const demo = { ...first, marker: "S2", sourceId: "demo", evidenceProvenance: "synthetic-demo" as const };
const input: EvidenceMatrixInput = { subClaims: ["First target", "Second target", "Version target", "Missing target", "Demo target"],
  citations: [first, second, versioned, demo], evidence: [first, second, versioned, demo].map((source, index) => ({
    ...source, claimIndex: index === 3 ? 4 : index, claim: index === 3 ? "Demo target" : ["First target", "Second target", "Version target"][index],
    quote: ["The ĐÁM MÂY retained passage.  \n\n", "Second article has distinct words.", "The later version passage.", "Illustrative only."][index],
    support: .5, qualifiesForAnswer: index !== 3, qualifiesForReward: false,
  })) };
const rows = buildEvidenceMatrix(input);
const defaults: MatrixInspectionFilters = { query: "", source: "", state: "all" };
const find = (filters: Partial<MatrixInspectionFilters>) => inspectEvidenceMatrix(rows, { ...defaults, ...filters });

describe("saved evidence inspection", () => {
  it("keeps original row identity, order, statuses and excerpt bytes", () => {
    const before = JSON.stringify(rows);
    const actual = find({ query: "  DAM   MAY retained  " });
    expect(actual.map(row => row.claimIndex)).toEqual([0]);
    expect(actual[0]).toBe(rows[0]);
    expect(actual[0].evidence[0].quote).toBe("The ĐÁM MÂY retained passage.  \n\n");
    expect(JSON.stringify(rows)).toBe(before);
  });

  it.each([first, second, versioned])("uses the complete cited article identity: %j", source => {
    const expected = source === first ? 0 : source === second ? 1 : 2;
    expect(find({ source: matrixSourceIdentity(source) }).map(row => row.claimIndex)).toEqual([expected]);
  });

  it("does not treat literal null, undefined or delimiter characters as an identity shortcut", () => {
    expect(matrixSourceIdentity({ marker: "a,b", sourceId: "c" })).not.toBe(matrixSourceIdentity({ marker: "a", sourceId: "b,c" }));
    expect(matrixSourceIdentity({ ...first, itemUrl: undefined })).not.toBe(matrixSourceIdentity({ ...first, itemUrl: "null" }));
    // Old JSON may contain null despite the current optional-string contract. Keep
    // the presentation ledger's strict identity comparison even for that record.
    const historical = { ...first, itemUrl: null } as unknown as typeof first;
    expect(matrixSourceIdentity({ ...first, itemUrl: undefined })).not.toBe(matrixSourceIdentity(historical));
  });

  it("combines query and source against that article's eligible excerpts", () => {
    expect(find({ source: matrixSourceIdentity(first), query: "second article" })).toEqual([]);
    expect(find({ source: matrixSourceIdentity(second), query: "distinct words" }).map(row => row.claimIndex)).toEqual([1]);
    expect(find({ query: "v2 https://example.test/article?v=1" }).map(row => row.claimIndex)).toEqual([2]);
    expect(find({ source: "no-longer-cited" })).toEqual([]);
  });

  it("separates no-excerpt targets without turning illustrative evidence into real evidence", () => {
    expect(find({ state: "without-excerpts" }).map(row => row.claimIndex)).toEqual([3]);
    expect(find({ state: "with-excerpts" }).map(row => row.claimIndex)).toEqual([0, 1, 2, 4]);
    expect(find({ source: matrixSourceIdentity(demo) })[0].status).toBe("Illustrative demo excerpt");
    expect(find({ source: matrixSourceIdentity(first), state: "without-excerpts" })).toEqual([]);
    const unavailable = buildEvidenceMatrix({ ...input, evidence: undefined });
    expect(inspectEvidenceMatrix(unavailable, { ...defaults, state: "without-excerpts" })).toEqual(unavailable);
    expect(unavailable.every(row => row.status === "Evidence ledger unavailable")).toBe(true);
  });

  it("cannot discover rejected or uncited excerpts through search", () => {
    const ledger = buildEvidenceMatrix({ ...input, evidence: [...input.evidence!,
      { ...input.evidence![0], quote: "REJECTED_SECRET", qualifiesForAnswer: false },
      { ...input.evidence![0], quote: "UNCITED_SECRET", contentVersion: "uncited" },
      { ...input.evidence![0], quote: "OVERLONG_SECRET" + "x".repeat(240) },
    ] });
    for (const query of ["REJECTED_SECRET", "UNCITED_SECRET", "OVERLONG_SECRET"]) {
      expect(inspectEvidenceMatrix(ledger, { ...defaults, query })).toEqual([]);
    }
  });

  it("handles empty, literal markup and non-Latin queries without rewriting them", () => {
    expect(find({ query: " \t\n " })).toEqual(rows);
    expect(find({ query: "<script>[.*" })).toEqual([]);
    const retained = [{ ...rows[0], claim: "किताब 的版本" }];
    expect(inspectEvidenceMatrix(retained, { ...defaults, query: "किताब 版本" })).toEqual(retained);
    expect(inspectEvidenceMatrix(retained, { ...defaults, query: "कतब" })).toEqual([]);
  });
});
