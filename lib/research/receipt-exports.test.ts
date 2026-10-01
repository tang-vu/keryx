import { expect, it } from "vitest";
import { exportsFromCheckedReceipt } from "./receipt-exports";

it("exports recorded receipt article identities and answer-qualified public evidence", () => {
  const identity = { marker: "P1", sourceId: "public:paper", sourceName: "Publisher", itemId: "v1",
    itemTitle: "Recorded paper", itemUrl: "https://example.org/paper", contentVersion: "version1", sourceKind: "public-reference" };
  const result = exportsFromCheckedReceipt({ payload: { citations: [{ ...identity, weight: 1, rewardPlannedUsdc: 0, rationale: "read" }],
    claims: [{ claimIndex: 2, claim: "Recorded claim", evidence: [{ ...identity, quote: "Bounded excerpt", support: 0.8,
      qualifiesForAnswer: true, qualifiesForReward: false }, { ...identity, contentVersion: "wrong", quote: "Wrong version", support: 1, qualifiesForReward: true }] }] } });
  expect(result.bibtex.count).toBe(1);
  expect(result.evidenceCsv).toContain("Bounded excerpt");
  expect(result.evidenceCsv).not.toContain("Wrong version");
});

it("leaves old incomplete receipts readable and counts omitted article references", () => {
  const result = exportsFromCheckedReceipt({ payload: { citations: [{ marker: "S1", sourceName: "Creator" }] } });
  expect(result.bibtex).toEqual({ count: 0, omitted: 1, content: "" });
  expect(result.evidenceCsv).not.toContain("Recorded excerpt");
  expect(() => exportsFromCheckedReceipt({ payload: { claims: [{ bad: "optional ledger" }] } })).not.toThrow();
});
