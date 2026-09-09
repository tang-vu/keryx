import type { KeryxDB } from "../db/keryx-db";

type SpendReader = Pick<KeryxDB, "getPrivateResearchIntent" | "getPrivatePaymentState" |
  "listPrivateCreatorSubmissions" | "getPrivateCreatorConfirmation">;

/** Backend owner projection. The caller must authenticate payer; this is never public analytics.
 * Reads are an observation, not an atomic reservation or permission to spend/refund.
 */
export async function privateSpendView(db: SpendReader, id: string, payer: string) {
  const intent = await db.getPrivateResearchIntent(id, payer);
  if (!intent) return null;
  const incoming = await db.getPrivatePaymentState(id, payer);
  const admissions = await db.listPrivateCreatorSubmissions(id, payer);
  const budget = BigInt(Math.round(intent.submission.request.budget * 1e6));
  let committed = BigInt(0), unresolved = BigInt(0), processing = BigInt(0), confirmed = BigInt(0);
  const payments = [];
  for (const admission of admissions) {
    const { submission, kind, sourceId, itemId } = admission.data;
    const amount = BigInt(submission.amountMicros);
    committed += amount;
    const saved = await db.getPrivateCreatorConfirmation(id, payer, submission.authorizationId);
    const proof = saved?.confirmation;
    const status = !proof ? "unresolved" as const : proof.source === "circle-facilitator-success"
      ? "facilitator-confirmed" as const : proof.transferStatus;
    if (!proof) unresolved += amount;
    else if (status === "received" || status === "batched") processing += amount;
    else confirmed += amount;
    // Explicit allowlist: do not return the signed intent, nonce, worker, or raw storage rows.
    payments.push({ kind, sourceId, itemId, payee: submission.payee, amountMicros: amount.toString(),
      status, evidenceSource: proof?.source ?? null, reference: proof?.transaction ?? null,
      observedAt: saved?.settledAt ?? null });
  }
  if (committed > budget) throw new Error("Private creator budget invariant violated");
  return {
    format: "private-spend-v1" as const,
    network: intent.requirement.network,
    asset: intent.requirement.asset,
    incoming: {
      status: incoming?.status ?? "not-submitted",
      priceMicros: intent.submission.payment.authorization.value,
      reference: incoming?.confirmation?.transaction ?? null,
      evidenceSource: incoming?.confirmation?.source ?? null,
      observedAt: incoming?.settledAt ?? null,
    },
    creator: {
      budgetMicros: budget.toString(), committedMicros: committed.toString(),
      unresolvedMicros: unresolved.toString(), processingMicros: processing.toString(),
      confirmedMicros: confirmed.toString(), uncommittedMicros: (budget - committed).toString(),
      payments,
    },
    // Admission is permanent even after expiry/confirmation; uncommitted is not a refund.
    observation: "durable-evidence-read" as const,
    chainFinalityVerified: false as const,
  };
}
