import { z } from "zod";
import { recoverMessageAddress, type Hex } from "viem";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { parseSessionGrantConsent, createSessionGrantConsentMessage, createSessionGrantSignerProofMessage } from "../payments/session-grant-consent";
import { withdrawPolicySchema, withdrawRequestSchema, validateWithdrawIntent } from "./withdraw-protocol";
import { assertWithdrawalNetworkPolicy } from "./withdrawal-network";

const address = z.string().regex(/^0x[0-9a-f]{40}$/), hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
export const sessionWithdrawalMicros = z.string().regex(/^(0|[1-9][0-9]{0,15})$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) < (BigInt(1) << BigInt(256)) - BigInt(1));
export const sessionWithdrawalPrepareInput = z.object({ sessAddr: address, grantEpoch: z.string().uuid(),
  amountMicros: sessionWithdrawalMicros.refine(value => BigInt(value) > BigInt(0)) }).strict();
export const sessionWithdrawalSubmitInput = z.object({ requestId: hash, signature }).strict();
export const sessionWithdrawalPreparationSchema = z.object({
  format: z.literal("keryx-session-withdrawal-preparation-v1"), network: z.literal("eip155:5042"),
  requestId: hash, ownerAddr: address, sessAddr: address, grantEpoch: z.string().uuid(),
  authorization: z.object({ consent: z.unknown().transform(value => parseSessionGrantConsent(value, ARC_MAINNET_PROFILE)),
    ownerSignature: signature, sessionSignature: signature }).strict(),
  burnIntent: withdrawRequestSchema.shape.burnIntent, policy: withdrawPolicySchema,
  balance: z.object({ availableMicroUsdc: sessionWithdrawalMicros, heldPaymentMicroUsdc: sessionWithdrawalMicros,
    heldWithdrawalMicroUsdc: sessionWithdrawalMicros, maxFeeMicroUsdc: sessionWithdrawalMicros }).strict(),
  height: z.object({ minimumBlockHeight: uint, maximumBlockHeight: uint, observedBlockNumber: uint,
    observedBlockHash: hash, observedAt: z.string().datetime() }).strict(),
}).strict();
export type SessionWithdrawalPreparation = z.infer<typeof sessionWithdrawalPreparationSchema>;

/** Exact public recovery proof and original unsigned request. Payment consent expiry is
 * deliberately not a custody-recovery expiry. Parsing never authorizes a vendor call. */
export function parseSessionWithdrawalPreparation(value: unknown): SessionWithdrawalPreparation {
  const p = sessionWithdrawalPreparationSchema.parse(value), c = p.authorization.consent;
  assertWithdrawalNetworkPolicy(p.policy, ARC_MAINNET_PROFILE);
  const intent = validateWithdrawIntent(p.burnIntent, p.policy);
  if (p.ownerAddr !== c.ownerAddr || p.sessAddr !== c.sessAddr || p.grantEpoch !== c.grantEpoch ||
    p.policy.owner !== p.sessAddr || p.policy.recipient !== p.ownerAddr || p.requestId !== intent.id ||
    p.balance.maxFeeMicroUsdc !== p.burnIntent.maxFee || p.policy.maxFeeMicros !== p.burnIntent.maxFee ||
    BigInt(p.height.observedBlockNumber) >= BigInt(p.height.minimumBlockHeight) ||
    BigInt(p.height.minimumBlockHeight) > BigInt(p.burnIntent.maxBlockHeight) ||
    BigInt(p.burnIntent.maxBlockHeight) > BigInt(p.height.maximumBlockHeight) ||
    BigInt(p.burnIntent.spec.value) + BigInt(p.burnIntent.maxFee) + BigInt(p.balance.heldPaymentMicroUsdc) +
      BigInt(p.balance.heldWithdrawalMicroUsdc) > BigInt(p.balance.availableMicroUsdc))
    throw new Error("Session withdrawal terms refused");
  return p;
}
export async function verifySessionWithdrawalPreparation(value: unknown): Promise<SessionWithdrawalPreparation> {
  const p = parseSessionWithdrawalPreparation(value), c = p.authorization.consent;
  const owner = await recoverMessageAddress({ message: createSessionGrantConsentMessage(c, ARC_MAINNET_PROFILE),
    signature: p.authorization.ownerSignature as Hex });
  const signer = await recoverMessageAddress({ message: createSessionGrantSignerProofMessage(c, ARC_MAINNET_PROFILE),
    signature: p.authorization.sessionSignature as Hex });
  if (owner.toLowerCase() !== p.ownerAddr || signer.toLowerCase() !== p.sessAddr)
    throw new Error("Session recovery ownership proof refused");
  return p;
}
