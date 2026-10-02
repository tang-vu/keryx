import { z } from "zod";
import { AskQuestionSchema } from "../ask-input";
import { addressSchema, BUYER_NETWORK, BUYER_PROFILE } from "../buyer/protocol";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { browserSha256 } from "../browser-receipt-integrity";

export const MONTHLY_PATH = "/api/research/monthly";
export const monthlyIdSchema = z.string().regex(/^monthly_[a-f0-9]{64}$/);
export function monthlyQuoteSchemaForProfile(profile: ArcNetworkProfile) {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Monthly profile refused");
  return z.object({
  plan: z.literal("research-monthly-v1"), requests: z.literal(4), termDays: z.literal(30),
  researchMode: z.literal("deep"), packageVersion: z.literal("1.0.0"),
  creatorBudgetMicros: z.number().int().positive().max(profile.testnet ? 500000 : Math.floor(Number.MAX_SAFE_INTEGER / 4)),
  serviceFeeMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), totalMicros: z.number().int().positive().max(profile.testnet ? 1000000 : Number.MAX_SAFE_INTEGER),
  separateTotalMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), roundingMicros: z.number().int().min(0).max(3),
  payee: addressSchema, network: z.literal(profile.networkId), quoteId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(v => BigInt(v.totalMicros) === BigInt(4) * BigInt(v.creatorBudgetMicros) + BigInt(v.serviceFeeMicros)
  && v.serviceFeeMicros % 4 === 0
  && BigInt(v.totalMicros) === ((BigInt(v.separateTotalMicros) * BigInt(9) + BigInt(39)) / BigInt(40)) * BigInt(4)
  && BigInt(v.roundingMicros) === BigInt(v.totalMicros) - (BigInt(v.separateTotalMicros) * BigInt(9) + BigInt(9)) / BigInt(10));
}
export const monthlyQuoteSchema = monthlyQuoteSchemaForProfile(BUYER_PROFILE);
export type MonthlyQuote = z.infer<typeof monthlyQuoteSchema>;
export const monthlyProofSchema = z.object({ payer: addressSchema, timestamp: z.number().int().positive(),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/) }).strict();
export const monthlyRedeemSchema = z.object({ monthlyId: monthlyIdSchema,
  requestId: z.string().uuid(), question: AskQuestionSchema, proof: monthlyProofSchema }).strict();
export const monthlyRecoveryRequestSchema = z.object({ monthlyId: monthlyIdSchema,
  requestId: z.string().uuid(), question: AskQuestionSchema, payer: addressSchema }).strict();

/** Purpose, host, chain, action and complete payload are covered by the wallet signature. */
export function monthlyMessage(action: "status" | "redeem", payload: unknown, timestamp: number) {
  return `Keryx Research Monthly v1\nOrigin: https://keryx.cc\nNetwork: ${BUYER_NETWORK}\nAction: ${action}\nTimestamp: ${timestamp}\nPayload: ${JSON.stringify(payload)}`;
}


/** Recovery files are bound to the original rail. Legacy raw requests are testnet only. */
export function monthlyRecoveryFileSchemaForProfile(profile: ArcNetworkProfile) {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Monthly profile refused");
  const envelope = z.object({ schema: z.literal("keryx-monthly-recovery-v2"),
    network: z.literal(profile.networkId), request: monthlyRecoveryRequestSchema }).strict().transform(value => value.request);
  return profile.testnet ? z.union([envelope, monthlyRecoveryRequestSchema]) : envelope;
}
export const monthlyRecoveryFileSchema = monthlyRecoveryFileSchemaForProfile(BUYER_PROFILE);
export function monthlyRecoveryFile(request: z.infer<typeof monthlyRecoveryRequestSchema>) {
  return { schema: "keryx-monthly-recovery-v2" as const, network: BUYER_NETWORK, request: monthlyRecoveryRequestSchema.parse(request) };
}

/** Same original identity as native Monthly admission; a shaped foreign job is insufficient. */
export async function monthlyRedemptionJobId(id: string, requestId: string) {
  const originalId = monthlyIdSchema.parse(id), originalRequest = z.string().uuid().parse(requestId);
  return `a2a_${(await browserSha256(JSON.stringify(["keryx-monthly-redemption-v1", originalId, originalRequest]))).slice(7)}`;
}
