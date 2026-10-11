import { expect, it } from "vitest";
import { assertPurchaseOutcomePrivacy } from "../../test-support/purchase-outcome-privacy";
import { PURCHASE_AGGREGATE_RULES } from "./purchase-outcome-aggregate";

const privateValues = ["PRIVATE SIDECAR SOURCE", "private-asset", "private-source", `0x${"a".repeat(40)}`,
  "Synthetic public replay of retained purchase inputs", "Retained fixture decision"];

it("allows public counting-rule prose while retaining a meaningful pooled privacy gate", () => {
  expect(PURCHASE_AGGREGATE_RULES.unmeasured).toContain("recorded question type");
  expect(() => assertPurchaseOutcomePrivacy({ rules: PURCHASE_AGGREGATE_RULES,
    notice: "No payer, payee, wallet, nonce, authorization or rationale is returned.",
    columns: [{ cohort: "unknown", scoredPurchases: 0 }] }, privateValues, true)).not.toThrow();
});

it.each(["question", "asker", "payer", "payee", "wallet", "walletAddress", "nonce", "authorization", "rationale",
  "decisionReviews", "reviewId", "originalFulfillment"])("refuses nested private field %s even with an innocuous value", key => {
  expect(() => assertPurchaseOutcomePrivacy({ nested: [{ [key]: "innocuous" }] }, privateValues, true)).toThrow("Private field retained");
});

it.each(["sourceId", "itemId", "assetId", "contentVersion", "dispatchId", "runId"])("excludes pooled identity %s while preserving the per-report role", key => {
  expect(() => assertPurchaseOutcomePrivacy({ nested: [{ [key]: "public-identity" }] }, privateValues)).not.toThrow();
  expect(() => assertPurchaseOutcomePrivacy({ nested: [{ [key]: "public-identity" }] }, privateValues, true)).toThrow("Private field retained");
});

it.each(privateValues)("refuses a private fixture value in nested text or a key: %s", privateValue => {
  expect(() => assertPurchaseOutcomePrivacy({ nested: [{ note: `Prefix ${privateValue} suffix` }] }, privateValues, true))
    .toThrow("Private fixture value retained");
  expect(() => assertPurchaseOutcomePrivacy({ nested: { [privateValue]: "innocuous" } }, privateValues, true))
    .toThrow("Private fixture value retained");
});

it("refuses an empty or missing private sentinel list", () => {
  for (const values of [[], [""]]) expect(() => assertPurchaseOutcomePrivacy({}, values, true)).toThrow("Private fixture values required");
});
