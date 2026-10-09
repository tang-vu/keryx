import { expect, it } from "vitest";
import { buyerRequestSchema } from "../buyer/protocol";
import { privateRequestSchema } from "../buyer/private-request-commitment";
import { monthlyRedeemSchema } from "../monthly/protocol";
const request = { question: "Synthetic question", budget: 0.03, researchMode: "deep", packageVersion: "1.0.0", responseMode: "async" };
it.each([{ reviewFirst: true }, { reviewFirst: false }, { mode: "review-first" }, { researchMode: "review-first" }])("queued public/private requests refuse unsupported fields without stripping intent: %j", intent => {
  expect(buyerRequestSchema.safeParse(request).success).toBe(true);
  expect(privateRequestSchema.safeParse({ ...request, access: "payer-private-v1", model: null }).success).toBe(true);
  expect(buyerRequestSchema.safeParse({ ...request, ...intent }).success).toBe(false);
  expect(privateRequestSchema.safeParse({ ...request, access: "payer-private-v1", model: null, ...intent }).success).toBe(false);
});
it("monthly redemption refuses review-first rather than creating an unattended continuation", () => {
  const redeem = { monthlyId: `monthly_${"a".repeat(64)}`, requestId: "11111111-1111-4111-8111-111111111111", question: "Synthetic question",
    proof: { payer: `0x${"1".repeat(40)}`, timestamp: 1800000000, signature: `0x${"a".repeat(130)}` } };
  expect(monthlyRedeemSchema.safeParse(redeem).success).toBe(true);
  expect(monthlyRedeemSchema.safeParse({ ...redeem, reviewFirst: true }).success).toBe(false);
});
