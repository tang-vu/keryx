import { z } from "zod";
import { resumeResearch } from "./client";
import { BUYER_NETWORK } from "./policy";
import { buyerFetch, type BuyerFetch } from "./transport";

const amount = z.number().finite().nonnegative();
// This independent allowlist is a privacy boundary. Never spread the original job,
// receipt, payment acknowledgement or error into the shareable output.
const reportInput = z.object({
  status: z.enum(["queued", "processing", "review_required", "completed", "failed", "not_found_uncertain"]),
  payment: z.object({ state: z.enum(["seller_reported_settled", "unconfirmed"]) }),
  pricing: z.object({
    serviceFeeUsdc: amount, creatorBudgetUsdc: amount, totalPriceUsdc: amount,
    settledCreatorSpendUsdc: amount, pendingCreatorSpendUsdc: amount,
    unusedCreatorReserveUsdc: amount.nullable(), accountingComplete: z.boolean().optional(),
  }).optional(),
  serviceStatus: z.object({
    elapsedMs: amount, targetCompletionMs: amount, targetBreached: z.boolean(),
  }).optional(),
  serviceReceipt: z.object({
    totalDurationMs: amount, targetCompletionMs: amount, targetMet: z.boolean(),
    quality: z.object({
      status: z.enum(["measured", "unavailable"]),
      groundedClaimRate: z.number().min(0).max(1).nullable(),
    }).optional(),
  }).optional(),
  claimCoverage: z.array(z.object({
    claimIndex: z.number().int().nonnegative(), coverage: z.number().min(0).max(1),
  })).optional(),
  verification: z.object({
    integrity: z.literal("verified"), requestBinding: z.literal("verified"),
    settlement: z.object({
      mode: z.literal("real"),
      ledgerCompleteness: z.enum(["complete", "incomplete", "legacy", "not_applicable"]),
      settledCreatorUsdc: amount, pendingCreatorUsdc: amount, simulatedCreatorUsdc: z.literal(0),
    }),
  }).optional(),
}).refine(value => value.status !== "completed" || (value.verification && value.pricing),
  "Completed reports require verified receipt and job economics");

/** A redacted diagnostic projection, not a signed receipt or independent settlement proof. */
export function buildBuyerReport(value: unknown) {
  const result = reportInput.parse(value);
  const pricing = result.pricing;
  const settlement = result.verification?.settlement;
  const micros = (value: number) => Math.round(value * 1e6);
  const accountingAgreement = pricing && settlement
    ? micros(pricing.settledCreatorSpendUsdc) === micros(settlement.settledCreatorUsdc)
      && micros(pricing.pendingCreatorSpendUsdc) === micros(settlement.pendingCreatorUsdc)
      ? "matches" : "differs"
    : "unavailable";
  return {
    schema: "keryx-buyer-report-v1" as const,
    network: BUYER_NETWORK,
    status: result.status,
    payment: result.payment,
    pricing: pricing ?? null,
    serviceStatus: result.serviceStatus ?? null,
    serviceReceipt: result.serviceReceipt ?? null,
    targetCoverage: result.claimCoverage ?? null,
    receiptVerification: result.verification ?? null,
    accountingAgreement,
    authority: {
      report: "Local buyer diagnostic; not a portable receipt or independent proof",
      payment: "Retained seller response, when available; otherwise unconfirmed",
      creatorSettlement: "Keryx ledger; not independently verified",
      quality: "Seller-reported model assessments; not factual correctness guarantees",
    },
    privacy: "Identifiers and research content omitted; amounts and quality may still be sensitive. Review before sharing.",
  };
}

/** Reuses verified GET-only recovery; never signs or submits a purchase. */
export async function reportResearch(directory: string, http: BuyerFetch = buyerFetch) {
  return buildBuyerReport(await resumeResearch(directory, http));
}
