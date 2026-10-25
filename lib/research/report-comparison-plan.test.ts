import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { RESEARCH_RECEIPT_SCHEMA } from "../research-receipt-types";
import { compareSavedResearch } from "./report-comparison";
import { compareResearchWithPlan, createReportComparisonPlan, MAX_COMPARISON_PLAN_BYTES, restoreReportComparisonPlan } from "./report-comparison-plan";

function receipt(question: string, claims = ["Same target", "Renamed target"]) {
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { question, answer: "PRIVATE_REPORT_TEXT" }, citations: [],
    claims: claims.map((claim, claimIndex) => ({ claim, claimIndex, evidence: [] })) };
  return JSON.stringify({ payload, integrity: { algorithm: "sha256", scope: "payload", canonicalization: "keryx-json-v1",
    digest: `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}` } });
}
const before = receipt("before"), after = receipt("after", ["Same target", "Different target"]);

it("round-trips an explicit mapping without retaining private report text", async () => {
  const matches = [{ beforeClaimIndex: 0, afterClaimIndex: 1 }, { beforeClaimIndex: 1, afterClaimIndex: 0 }];
  const comparison = await compareSavedResearch({ before, after, matches });
  const plan = JSON.stringify(createReportComparisonPlan(comparison));
  expect(plan).not.toContain("PRIVATE_REPORT_TEXT"); expect(plan).not.toContain("target");
  expect(restoreReportComparisonPlan(plan, comparison)).toEqual(matches);
  expect(await compareResearchWithPlan({ before, after, matchingPlan: plan })).toEqual(comparison);
});

it("keeps explicit empty mappings empty instead of reapplying inferred matches", async () => {
  const base = await compareSavedResearch({ before, after });
  const plan = JSON.stringify(createReportComparisonPlan(base, []));
  const restored = await compareResearchWithPlan({ before, after, matchingPlan: plan });
  expect(restored.targets).toHaveLength(4);
  expect(restored.targets.every(row => row.match === "unmatched")).toBe(true);
});

it("refuses changed or reversed ordered receipts even when their indices still exist", async () => {
  const base = await compareSavedResearch({ before, after });
  const plan = JSON.stringify(createReportComparisonPlan(base));
  await expect(compareResearchWithPlan({ before: after, after: before, matchingPlan: plan })).rejects.toMatchObject({ code: "matching-receipts-mismatch" });
  await expect(compareResearchWithPlan({ before, after: receipt("changed"), matchingPlan: plan })).rejects.toMatchObject({ code: "matching-receipts-mismatch" });
});

it("refuses a receipt whose payload was changed without updating its checksum", async () => {
  const base = await compareSavedResearch({ before, after }), changed = JSON.parse(after);
  changed.payload.dispatch.answer = "tampered";
  await expect(compareResearchWithPlan({ before, after: JSON.stringify(changed), matchingPlan: JSON.stringify(createReportComparisonPlan(base)) }))
    .rejects.toMatchObject({ code: "invalid-receipt" });
});

it("validates one-to-one existing indices and refuses ambiguous or expanded plan fields", async () => {
  const base = await compareSavedResearch({ before, after }), plan = createReportComparisonPlan(base);
  for (const matches of [[{ beforeClaimIndex: 0, afterClaimIndex: 0 }, { beforeClaimIndex: 0, afterClaimIndex: 1 }],
    [{ beforeClaimIndex: 0, afterClaimIndex: 0 }, { beforeClaimIndex: 1, afterClaimIndex: 0 }],
    [{ beforeClaimIndex: 5, afterClaimIndex: 0 }], [{ beforeClaimIndex: -1, afterClaimIndex: 0 }]]) {
    expect(() => restoreReportComparisonPlan(JSON.stringify({ ...plan, matches }), base)).toThrow("invalid-matching-plan");
  }
  expect(() => restoreReportComparisonPlan(JSON.stringify({ ...plan, receiptUrl: "https://example.com/private" }), base)).toThrow("invalid-matching-plan");
  await expect(compareResearchWithPlan({ before, after, matches: [], matchingPlan: JSON.stringify(plan) })).rejects.toMatchObject({ code: "invalid-matching-plan" });
});

it("bounds plan input and rejects malformed JSON and unsupported formats", async () => {
  const base = await compareSavedResearch({ before, after }), plan = createReportComparisonPlan(base);
  for (const raw of ["null", "not JSON", JSON.stringify({ ...plan, format: "future" }), " ".repeat(MAX_COMPARISON_PLAN_BYTES + 1),
    JSON.stringify({ ...plan, beforeDigest: "sha256:bad" })]) {
    expect(() => restoreReportComparisonPlan(raw, base)).toThrow("invalid-matching-plan");
  }
  expect(restoreReportComparisonPlan("\ufeff" + JSON.stringify(plan), base)).toEqual(plan.matches);
});
