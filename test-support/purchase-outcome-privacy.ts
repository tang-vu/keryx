import assert from "node:assert/strict";

const privateFields = ["question", "asker", "payer", "payee", "wallet", "walletAddress", "nonce",
  "authorization", "rationale", "decisionReviews", "reviewId", "originalFulfillment"];
const pooledIdentityFields = ["sourceId", "itemId", "assetId", "contentVersion", "dispatchId", "runId"];

/** Inspect public packet structure and actual fixture values, not words in public counting rules. */
export function assertPurchaseOutcomePrivacy(packet: unknown, privateValues: readonly string[], pooled = false): void {
  assert(privateValues.length > 0 && privateValues.every(value => typeof value === "string" && value.length > 0),
    "Private fixture values required");
  const forbidden = new Set([...privateFields, ...(pooled ? pooledIdentityFields : [])]);
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      assert(privateValues.every(privateValue => !value.includes(privateValue)), "Private fixture value retained");
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        assert(!forbidden.has(key), "Private field retained");
        visit(key); visit(nested);
      }
    }
  };
  visit(packet);
}
