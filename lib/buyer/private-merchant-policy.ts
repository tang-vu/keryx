import { z } from "zod";
import { addressSchema, type BuyerRequirement } from "./protocol";

/** Trusted application configuration, never a merchant choice from a submitted body. */
export const privateMerchantPolicySchema = z.object({
  privatePayee: addressSchema,
  publicResearchPayee: addressSchema,
}).strict().refine(
  policy => policy.privatePayee.toLowerCase() !== policy.publicResearchPayee.toLowerCase(),
  "Private and public research must use distinct merchants",
);
export type PrivateMerchantPolicy = z.infer<typeof privateMerchantPolicySchema>;

/** Necessary separation only. Public seller routes must also reserve the private payee. */
export function requirePrivateMerchant(requirement: BuyerRequirement, policyValue: unknown): void {
  const policy = privateMerchantPolicySchema.parse(policyValue);
  if (requirement.payTo.toLowerCase() !== policy.privatePayee.toLowerCase()) {
    throw new Error("Quote payee does not match the trusted merchant");
  }
}
