import { createHash } from "node:crypto";
import { z } from "zod";
import { addressSchema, BUYER_NETWORK } from "../buyer/protocol";
import { privateMerchantPolicySchema } from "../buyer/private-merchant-policy";
import { privateReasoningPolicySchema } from "../buyer/private-reasoning-policy";
import type { privateRuntimePolicy } from "./private-runtime-policy";

type Policy = NonNullable<ReturnType<typeof privateRuntimePolicy>>;

/** Compare public operating policy, never API credentials or wallet/encryption keys.
 * A digest is not authentication, a funds check or evidence of a healthy provider. */
export function privateWorkerConfigurationId(policy: Pick<Policy, "merchants" | "treasury" | "serviceFeeMicros" | "disclosure">) {
  const merchants = privateMerchantPolicySchema.parse(policy.merchants);
  const treasury = z.object({ signer: addressSchema, capacityMicros: z.string().regex(/^[1-9]\d{0,11}$/) }).strict().parse(policy.treasury);
  const fee = z.string().regex(/^[1-9]\d{0,5}$/).refine(value => Number(value) <= 500000).parse(policy.serviceFeeMicros);
  const disclosure = privateReasoningPolicySchema.parse(policy.disclosure);
  return createHash("sha256").update(JSON.stringify({ schema: "keryx-private-worker-configuration-v1", network: BUYER_NETWORK,
    privatePayee: merchants.privatePayee.toLowerCase(), publicPayee: merchants.publicResearchPayee.toLowerCase(),
    treasurySigner: treasury.signer.toLowerCase(), capacityMicros: treasury.capacityMicros, serviceFeeMicros: fee,
    reasoning: disclosure })).digest("hex");
}
