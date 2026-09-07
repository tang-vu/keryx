import { z } from "zod";
import { buyerJobSchema } from "../a2a/buyer-workspace";
import { a2aResearchPackage, a2aResearchPackageFingerprint } from "../a2a/research-package";
import { canonicalJson, sha256, verifyResearchReceipt } from "../research-receipt-integrity";
import type { BuyerIntent } from "./journal";
import { BUYER_NETWORK, decodeHeader } from "./policy";

export function sellerPaymentEvidence(header: string | null, intent: BuyerIntent) {
  try {
    const evidence = z.object({ success: z.literal(true), transaction: z.string().min(1).max(256), payer: z.string(), network: z.literal(BUYER_NETWORK) }).parse(decodeHeader(header));
    if (evidence.payer.toLowerCase() !== intent.authorization.from.toLowerCase()) return null;
    return { ...evidence, authority: "seller-relayed-payment-response" as const, independentlyVerified: false as const };
  } catch { return null; }
}

export function verifyBuyerJob(value: unknown, intent: BuyerIntent) {
  const job = buyerJobSchema.parse(value);
  if (job.queryId !== intent.queryId) throw new Error("Wrong job returned");
  const envelope = z.object({ researchPackage: z.unknown() }).parse(value);
  const expected = a2aResearchPackage(intent.request.researchMode);
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
  return { job, packageFingerprint: a2aResearchPackageFingerprint(expected) };
}

export function verifyBuyerReceipt(value: unknown, headerDigest: string | null, intent: BuyerIntent, answer: string) {
  const integrity = verifyResearchReceipt(value);
  if (!integrity.valid || headerDigest !== integrity.actualDigest) throw new Error("Receipt integrity or HTTPS response digest mismatch");
  const receipt = z.object({ payload: z.object({
    dispatch: z.object({ id: z.string(), question: z.string(), answer: z.string(), answerSha256: z.string(), budgetUsdc: z.number(), researchMode: z.string() }),
    settlement: z.object({ mode: z.literal("real"), ledgerCompleteness: z.string(), settledCreatorUsdc: z.number().finite().nonnegative(), pendingCreatorUsdc: z.number().finite().nonnegative(), simulatedCreatorUsdc: z.literal(0) }).passthrough(),
  }).passthrough() }).passthrough().parse(value);
  const d = receipt.payload.dispatch;
  if (d.id !== intent.queryId || d.question !== intent.request.question || d.answer !== answer
    || d.answerSha256 !== sha256(answer) || d.researchMode !== intent.request.researchMode
    || Math.round(d.budgetUsdc * 1e6) !== Math.round(intent.request.budget * 1e6)) throw new Error("Receipt does not bind the requested research and returned answer");
  const s = receipt.payload.settlement;
  if (Math.round((s.settledCreatorUsdc + s.pendingCreatorUsdc) * 1e6) > Math.round(intent.request.budget * 1e6)) throw new Error("Receipt creator spend exceeds cap");
  return { digest: integrity.actualDigest!, integrity: "verified" as const, requestBinding: "verified" as const, settlement: s, settlementAuthority: "Keryx ledger; not independently verified" };
}
