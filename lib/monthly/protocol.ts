import { z } from "zod";
import { AskQuestionSchema } from "../ask-input";
import { addressSchema, BUYER_NETWORK } from "../buyer/protocol";

export const MONTHLY_PATH = "/api/research/monthly";
export const monthlyIdSchema = z.string().regex(/^monthly_[a-f0-9]{64}$/);
export const monthlyQuoteSchema = z.object({
  plan: z.literal("research-monthly-v1"), requests: z.literal(4), termDays: z.literal(30),
  researchMode: z.literal("deep"), packageVersion: z.literal("1.0.0"),
  creatorBudgetMicros: z.number().int().positive().max(500000),
  serviceFeeMicros: z.number().int().positive(), totalMicros: z.number().int().positive().max(1000000),
  separateTotalMicros: z.number().int().positive(), roundingMicros: z.number().int().min(0).max(3),
  payee: addressSchema, network: z.literal(BUYER_NETWORK), quoteId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(v => v.totalMicros === 4 * v.creatorBudgetMicros + v.serviceFeeMicros
  && v.serviceFeeMicros % 4 === 0 && v.totalMicros === Math.ceil(v.separateTotalMicros * 9 / 40) * 4);
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
