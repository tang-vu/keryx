import { z } from "zod";
import { readPrivateBuyerJournal } from "./private-journal";
import type { PrivateMerchantPolicy } from "./private-merchant-policy";
import { BUYER_ORIGIN } from "./protocol";
import { buyerFetch, type BuyerFetch } from "./transport";
import { readBoundedJson } from "../read-bounded-json";
import { privateWorkspaceResultSchema } from "../a2a/private-workspace";

/** Node buyer recovery using an existing live account session. No login, signature,
 * submission retry or journal mutation. The returned view is server-reported evidence,
 * not a portable cryptographic receipt or independent chain-finality verification. */
export async function recoverPrivateBuyerResult(directory: string, payer: string, merchants: PrivateMerchantPolicy,
  sessionCookie: string, http: BuyerFetch = buyerFetch) {
  const parsedCookie = z.string().max(8192).regex(/^keryx_session=[A-Za-z0-9._-]+$/).safeParse(sessionCookie);
  if (!parsedCookie.success) throw new Error("Private result recovery requires a valid session cookie");
  const cookie = parsedCookie.data;
  const intent = await readPrivateBuyerJournal(directory, payer, merchants);
  let response: Response;
  try {
    response = await http(`${BUYER_ORIGIN}/api/me/private-jobs/result`, { method: "POST", redirect: "error", cache: "no-store",
      headers: { origin: BUYER_ORIGIN, "content-type": "application/json", cookie }, body: JSON.stringify({ id: intent.id }),
      signal: AbortSignal.timeout(30_000) });
  } catch { throw new Error("Private result recovery unavailable"); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401) throw new Error("Private result recovery requires a live account session");
    if (response.status === 404) throw new Error("Private result unavailable for this account");
    throw new Error("Private result recovery unavailable");
  }
  try {
    const view = privateWorkspaceResultSchema.parse(await readBoundedJson(response, 16_777_216));
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
