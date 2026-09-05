import { z } from "zod";

export const a2aQueryIdSchema = z.string().regex(/^a2a_[a-f0-9]{64}$/);
const amount = z.number().finite().nonnegative();

/** Only display validated response fields. Missing historical measurements remain unknown. */
export const buyerJobSchema = z.object({
  queryId: a2aQueryIdSchema,
  status: z.enum(["queued", "processing", "review_required", "completed", "failed"]),
  answer: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  pricing: z.object({
    serviceFeeUsdc: amount,
    creatorBudgetUsdc: amount,
    totalPriceUsdc: amount,
    settledCreatorSpendUsdc: amount,
    pendingCreatorSpendUsdc: amount,
    unusedCreatorReserveUsdc: amount.nullable(),
    accountingComplete: z.boolean().optional(),
  }).optional(),
  serviceStatus: z.object({
    elapsedMs: amount,
    targetCompletionMs: amount,
    targetBreached: z.boolean(),
  }).optional(),
  serviceReceipt: z.object({
    totalDurationMs: amount,
    targetCompletionMs: amount,
    targetMet: z.boolean(),
    quality: z.object({
      status: z.enum(["measured", "unavailable"]),
      groundedClaimRate: z.number().min(0).max(1).nullable(),
    }).optional(),
  }).optional(),
  claimCoverage: z.array(z.object({
    claimIndex: z.number().int().nonnegative(),
    claim: z.string(),
    coverage: z.number().min(0).max(1),
  })).optional(),
  evidence: z.array(z.object({
    claimIndex: z.number().int().nonnegative(),
    sourceName: z.string(),
    quote: z.string(),
  })).optional(),
});

export type BuyerJob = z.infer<typeof buyerJobSchema>;

export function shouldPollBuyerJob(status: BuyerJob["status"]): boolean {
  return status === "queued" || status === "processing";
}

/** A decimal USDC cap must be representable exactly; never silently clamp a buyer's input. */
export function parseBuyerBudget(value: string, max: number): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) return null;
  return number;
}
