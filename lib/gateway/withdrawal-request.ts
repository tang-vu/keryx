import { z } from "zod";
import type { Hex } from "viem";
import { verifyWithdrawRequest, withdrawPolicySchema, withdrawRequestSchema, type WithdrawPolicy } from "./withdraw-protocol";
import { ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { gatewayNetworkProfile } from "./gateway-network";
import { assertWithdrawalNetworkPolicy } from "./withdrawal-network";

export const withdrawalIdSchema = z.string().regex(/^0x[a-f0-9]{64}$/).transform(value => value as Hex);
export const withdrawalOwnerSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase());
const schema = z.object({
  format: z.enum(["creator-withdrawal-request-v1", "creator-withdrawal-request-v2"]), network: z.enum(["eip155:5042002", "eip155:5042"]),
  id: withdrawalIdSchema, owner: withdrawalOwnerSchema,
  policy: withdrawPolicySchema, request: withdrawRequestSchema,
}).strict().refine(value => (value.network === "eip155:5042002") === (value.format === "creator-withdrawal-request-v1"));
export type WithdrawalRequestRecord = z.infer<typeof schema>;

/** Backend/private journal record. Never include its signature in public cash-out feeds. */
export async function createWithdrawalRequest(request: unknown, policy: WithdrawPolicy, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE): Promise<WithdrawalRequestRecord> {
  const selected = withdrawPolicySchema.parse(policy);
  assertWithdrawalNetworkPolicy(selected, profile);
  const verified = await verifyWithdrawRequest(request, selected);
  return { format: profile.testnet ? "creator-withdrawal-request-v1" : "creator-withdrawal-request-v2", network: profile.networkId, id: verified.id,
    owner: verified.owner, policy: selected, request: verified.request };
}

export async function validateWithdrawalRequest(value: unknown): Promise<WithdrawalRequestRecord> {
  try {
    const record = schema.parse(value);
    const checked = await createWithdrawalRequest(record.request, record.policy, gatewayNetworkProfile(record.network));
    if (checked.id !== record.id || checked.owner !== record.owner) throw new Error();
    return checked;
  } catch { throw new Error("Withdrawal request unavailable"); }
}
