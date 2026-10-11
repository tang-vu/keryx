import { expect, it } from "vitest";
import { buildDraftCheck } from "./draft-check";
import { evaluateDraftCheck } from "./draft-check-evaluation";
import { DRAFT_CHECK_EVALUATION_CASES as cases } from "./fixtures/draft-check-evaluation";

// Reported figures for method lexical-overlap-v1 on the fixed synthetic set. A change
// to the method or the set must update docs/draft-check.md with the new figures.
it("reports the false-supported rate on the fixed labelled set", () => {
  expect(new Set(cases.map(row => row.id)).size).toBe(cases.length);
  const result = evaluateDraftCheck(cases);
  expect(result.cases).toBe(50);
  expect(result.confusion).toEqual({
    "supported": { "supported": 15, "not-found": 3 },
    "partly-supported": { "partly-supported": 6 },
    "not-found": { "not-found": 18, "partly-supported": 5, "supported": 3 },
  });
  // Known failures stay in the set: word order is not analysed, so role reversals pass as supported.
  expect(result.falseSupported).toEqual(["u09", "u10", "u19"]);
  expect(result.falseSupportedRate).toBeCloseTo(3 / 32, 10);
  // Paraphrases with different vocabulary are reported not-found.
  expect(result.missedSupported).toEqual(["s11", "s12", "s17"]);
  expect(result.exactAgreement).toBeCloseTo(39 / 50, 10);
});

it("never reports an unread source as not found, for every labelled sentence", () => {
  for (const row of cases) {
    const check = buildDraftCheck({ version: 1, scope: "private-draft-check", passage: `${row.claim.replace(/\.$/, "")} [1].`,
      references: { format: "list", text: "https://example.org/synthetic-evaluation-source" }, sources: [] });
    expect(check.claims.map(claim => claim.verdict)).toEqual(["source-unavailable"]);
  }
});
