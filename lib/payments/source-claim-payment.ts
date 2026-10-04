import { getDb } from "../db";
import type { Source, SourceClaimReceipt } from "../types";
import { sourceFetchTerms } from "../registry/source-fetch-payto";
import { sourceClaimAccess } from "../sources/source-claim-access";

/** Recheck a newly created bearer before exposing/submitting it. Existing receipts stay original. */
export async function assertCreatorPaymentClaim(source: Source, claim: SourceClaimReceipt | undefined, kind: "fetch" | "citation") {
  if (!claim && !source.sourceClaimId) return;
  const db = await getDb(), current = await db.getSource(source.id);
  if (!current || current.active === false || current.verified === false) throw new Error("Source claim authority changed");
  const terms = await sourceFetchTerms(current, { refresh: true });
  const access = await sourceClaimAccess(db, current, terms, { expected: claim ?? null });
  if (kind === "fetch" ? !access.readAllowed || terms.listPriceUsdc <= 0 : !access.rewardAllowed)
    throw new Error("Source claim does not authorize this new payment");
}
