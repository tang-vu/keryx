import { expect, it } from "vitest";
import { buildDraftCheck } from "./draft-check";
import { evaluateDraftCheck } from "./draft-check-evaluation";
import { DRAFT_CHECK_EVALUATION_CASES as cases } from "./fixtures/draft-check-evaluation";

// Reported figures for method lexical-overlap-v2 on the fixed synthetic set. A change
// to the method or the set must update docs/draft-check.md with the new figures.
it("reports the false-supported rate on the fixed labelled set", () => {
  expect(new Set(cases.map(row => row.id)).size).toBe(cases.length);
  const result = evaluateDraftCheck(cases);
  expect(result.cases).toBe(50);
  expect(result.confusion).toEqual({
    "supported": { "supported": 15, "not-found": 3 },
    "partly-supported": { "partly-supported": 6 },
    "not-found": { "not-found": 21, "partly-supported": 5 },
  });
  // Keep the original failures in the unchanged set; comparative role reversals now withhold support.
  expect(result.falseSupported).toEqual([]);
  expect(result.falseSupportedRate).toBe(0);
  // Paraphrases with different vocabulary are reported not-found.
  expect(result.missedSupported).toEqual(["s11", "s12", "s17"]);
  expect(result.exactAgreement).toBeCloseTo(42 / 50, 10);
});

it("never reports an unread source as not found, for every labelled sentence", () => {
  for (const row of cases) {
    const check = buildDraftCheck({ version: 1, scope: "private-draft-check", passage: `${row.claim.replace(/\.$/, "")} [1].`,
      references: { format: "list", text: "https://example.org/synthetic-evaluation-source" }, sources: [] });
    expect(check.claims.map(claim => claim.verdict)).toEqual(["source-unavailable"]);
  }
});
