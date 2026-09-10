import { privateWorkspaceResultSchema } from "../a2a/private-workspace";
import type { PrivateBuyerIntent } from "./private-buyer-intent";

/** Server-reported recovery bound to the original signed request and exact creator ledger. */
export function validatePrivateBuyerResult(value: unknown, payer: string, intent: PrivateBuyerIntent) {
  try {
    const view = privateWorkspaceResultSchema.parse(value);
    const signed = intent.submission.request, creator = view.spend.creator;
    const budget = String(Math.round(signed.budget * 1e6));
    if (view.wallet !== payer.toLowerCase() || view.request.question !== signed.question || view.request.model !== signed.model
      || view.request.researchMode !== signed.researchMode || view.request.packageVersion !== signed.packageVersion
      || view.request.creatorBudgetMicros !== budget || creator.budgetMicros !== budget
      || view.spend.incoming.priceMicros !== intent.submission.payment.authorization.value)
      throw new Error();
    if (BigInt(creator.committedMicros) !== BigInt(creator.unresolvedMicros) + BigInt(creator.processingMicros) + BigInt(creator.confirmedMicros)
      || BigInt(budget) !== BigInt(creator.committedMicros) + BigInt(creator.uncommittedMicros)
      || BigInt(creator.committedMicros) !== creator.payments.reduce((sum, leg) => sum + BigInt(leg.amountMicros), BigInt(0))) throw new Error();
    const totals = { unresolved: BigInt(0), processing: BigInt(0), confirmed: BigInt(0) };
    for (const leg of creator.payments) {
      const group = leg.status === "unresolved" ? "unresolved" : leg.status === "received" || leg.status === "batched" ? "processing" : "confirmed";
      totals[group] += BigInt(leg.amountMicros);
    }
    if (totals.unresolved !== BigInt(creator.unresolvedMicros) || totals.processing !== BigInt(creator.processingMicros)
      || totals.confirmed !== BigInt(creator.confirmedMicros)
      || (view.status === "awaiting-payment") !== (view.spend.incoming.status !== "settled")) throw new Error();
    return view;
  } catch { throw new Error("Private result does not match the signed research context or spend accounting"); }
}
