import { z } from "zod";
import { buyerJobSchema } from "../a2a/buyer-workspace";
import { a2aResearchPackageForVersion } from "../a2a/research-package-definition";
import { canonicalJson } from "../canonical-json";
import type { BuyerIntentEnvelope as BuyerIntent } from "./protocol";
import { BUYER_NETWORK, decodeHeader } from "./protocol";

export function sellerPaymentEvidence(header: string | null, intent: BuyerIntent) {
  try {
    const evidence = z.object({ success: z.literal(true), transaction: z.string().min(1).max(256), payer: z.string(), network: z.literal(BUYER_NETWORK) }).parse(decodeHeader(header));
    if (evidence.payer.toLowerCase() !== intent.authorization.from.toLowerCase()) return null;
    return { ...evidence, authority: "seller-relayed-payment-response" as const, independentlyVerified: false as const };
  } catch { return null; }
}

export function verifyBuyerJobBinding(value: unknown, intent: BuyerIntent) {
  const job = buyerJobSchema.parse(value);
  if (job.queryId !== intent.queryId) throw new Error("Wrong job returned");
  const envelope = z.object({ researchPackage: z.unknown() }).parse(value);
  const expected = a2aResearchPackageForVersion(intent.request.researchMode, intent.request.packageVersion);
  if (!expected) throw new Error("Unsupported journal package version");
  if (canonicalJson(envelope.researchPackage) !== canonicalJson(expected)) throw new Error("Job package differs from the requested contract");
  if (job.pricing) {
    const p = job.pricing;
    const micros = (n: number) => Math.round(n * 1e6);
    if (micros(p.totalPriceUsdc) !== Number(intent.authorization.value)
      || micros(p.creatorBudgetUsdc) !== micros(intent.request.budget)
      || micros(p.serviceFeeUsdc) + micros(p.creatorBudgetUsdc) !== micros(p.totalPriceUsdc)
      || micros(p.settledCreatorSpendUsdc) + micros(p.pendingCreatorSpendUsdc) > micros(p.creatorBudgetUsdc)) throw new Error("Job economics differ from the paid request");
  }
  if (job.status === "completed" && (!job.pricing || typeof job.answer !== "string")) throw new Error("Completed job is missing answer or economics");
  return { job, expectedPackage: expected };
}

/** Binding validation only; callers must separately verify receipt integrity. */
export function verifyBuyerReceiptBinding(value: unknown, intent: BuyerIntent, answer: string, answerDigest: string) {
  const receipt = z.object({ payload: z.object({
    dispatch: z.object({ id: z.string(), question: z.string(), answer: z.string(), answerSha256: z.string(), budgetUsdc: z.number(), researchMode: z.string() }),
    settlement: z.object({ mode: z.literal("real"), ledgerCompleteness: z.string(), settledCreatorUsdc: z.number().finite().nonnegative(), pendingCreatorUsdc: z.number().finite().nonnegative(), simulatedCreatorUsdc: z.literal(0) }).passthrough(),
  }).passthrough() }).passthrough().parse(value);
  const d = receipt.payload.dispatch;
  if (d.id !== intent.queryId || d.question !== intent.request.question || d.answer !== answer
    || d.answerSha256 !== answerDigest || d.researchMode !== intent.request.researchMode
    || Math.round(d.budgetUsdc * 1e6) !== Math.round(intent.request.budget * 1e6)) throw new Error("Receipt does not bind the requested research and returned answer");
  const s = receipt.payload.settlement;
  if (Math.round((s.settledCreatorUsdc + s.pendingCreatorUsdc) * 1e6) > Math.round(intent.request.budget * 1e6)) throw new Error("Receipt creator spend exceeds cap");
  return s;
}
