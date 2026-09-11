import { z } from "zod";
import type { Hex } from "viem";
import { verifyWithdrawRequest, withdrawPolicySchema, withdrawRequestSchema, type WithdrawPolicy } from "./withdraw-protocol";

export const withdrawalIdSchema = z.string().regex(/^0x[a-f0-9]{64}$/).transform(value => value as Hex);
export const withdrawalOwnerSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase());
const schema = z.object({
  format: z.literal("creator-withdrawal-request-v1"), network: z.literal("eip155:5042002"),
  id: withdrawalIdSchema, owner: withdrawalOwnerSchema,
  policy: withdrawPolicySchema, request: withdrawRequestSchema,
}).strict();
export type WithdrawalRequestRecord = z.infer<typeof schema>;

/** Backend/private journal record. Never include its signature in public cash-out feeds. */
export async function createWithdrawalRequest(request: unknown, policy: WithdrawPolicy): Promise<WithdrawalRequestRecord> {
  const selected = withdrawPolicySchema.parse(policy);
  if (selected.domain !== 26) throw new Error("Withdrawal network unavailable");
  const verified = await verifyWithdrawRequest(request, selected);
  return { format: "creator-withdrawal-request-v1", network: "eip155:5042002", id: verified.id,
    owner: verified.owner, policy: selected, request: verified.request };
}

export async function validateWithdrawalRequest(value: unknown): Promise<WithdrawalRequestRecord> {
  try {
    const record = schema.parse(value);
    const checked = await createWithdrawalRequest(record.request, record.policy);
    if (checked.id !== record.id || checked.owner !== record.owner) throw new Error();
    return checked;
  } catch { throw new Error("Withdrawal request unavailable"); }
}
