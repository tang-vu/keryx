import { describe, expect, it } from "vitest";
import { assertOriginalFulfillmentQuality, ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE } from "./original-fulfillment-quality";
import { qualityQuestion, qualityTargets, qualityStatements } from "./original-fulfillment-quality-fixture";

const complete = () => ({ question: qualityQuestion, targets: qualityTargets, statements: qualityStatements() });
describe("private complete original answer contract", () => {
  it("accepts all source-backed requested parts with direct reviewed statements", () => {
    expect(() => assertOriginalFulfillmentQuality(complete())).not.toThrow();
    expect(qualityStatements().length).toBeLessThanOrEqual(32);
  });
  it.each(qualityStatements().map((row, index) => [index, row.quote] as const))
    ("refuses omission of required premise %s, despite high numeric coverage", index => {
      const input = complete(); input.statements.splice(index, 1);
      expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/missing required parts/);
    });
  it("cannot replace the whole documented flow by its first and last steps", () => {
    const input = complete(); input.statements = input.statements.filter(row => row.claimIndex !== 1 || /deposits|collects/.test(row.quote));
    expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/paid-request.*payment-required.*buyer-signature.*signed-retry.*immediate-delivery/);
  });
  it("requires sentence meaning, not a count or a topical quote beside an incomplete sentence", () => {
    const input = complete(), row = input.statements.find(row => row.quote.includes("at least 2 of 3"))!;
    row.text = "Gateway validates the request and returns an attestation.";
    expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/quorum-attestation/);
  });
  it("does not let a related source or wrong target supply a missing procedure", () => {
    const input = complete(), row = input.statements.find(row => row.quote.includes("buyer retries"))!;
    row.claimIndex = 4;
    expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/signed-retry/);
    row.claimIndex = 1; row.marker = "S1";
    expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/signed-retry/);
  });
  it("preserves numeric and trust qualifications in the reviewed sentence", () => {
    const input = complete(), row = input.statements.find(row => row.quote.includes("quorum of multiple"))!;
    row.text = "Gateway's quorum guarantees correct and secure RPC validation.";
    expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/rpc-trust/);
  });
  it("keeps this versioned contract scoped to the exact retained original", () => {
    expect(() => assertOriginalFulfillmentQuality({ ...complete(), question: "Explain another payment rail." })).toThrow(/scope mismatch/);
    expect(() => assertOriginalFulfillmentQuality({ ...complete(), targets: qualityTargets.slice(0, 4) })).toThrow(/scope mismatch/);
  });
  it("refuses mainnet or readiness assertions added to the network table", () => {
    for (const text of ["Arc mainnet uses chain 5042, USDC and explorer.arc.io.",
      "The deployed Arc network uses chain 5042, USDC and explorer.arc.io."]) {
      const input = complete(); input.statements.find(row => row.marker === "S3")!.text = text;
      expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/arc-profile/);
    }
  });
  it("retains policy examples without certifying an actual configured policy", () => {
    const input = complete(), row = input.statements.find(row => row.claimIndex === 4 && row.marker === "S1")!;
    row.text = "The configured contract enforces allowlists and spending limits before approving an action.";
    expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/bounded-contract-policy/);
    row.text = "Examples prove the deployed contract enforces allowlists and spending limits before approving an action.";
    expect(() => assertOriginalFulfillmentQuality(input)).toThrow(/bounded-contract-policy/);
  });
  it("replaces the two-option shortcut with a bounded full-detail contract", () => {
    expect(ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE).toContain("every stage");
    expect(ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE).toContain("29 complementary rows");
    expect(ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE).toContain("Do not substitute a related sentence");
    expect(ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE).toContain("do not claim tests were executed");
  });
});
