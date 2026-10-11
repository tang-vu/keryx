import { canonicalJson, researchReceiptDigest } from "../research-receipt-integrity";
import type { PaymentRecord, QueryRun } from "../types";
import type { KeryxDB } from "../db/keryx-db";
import { requirePrivacy } from "./contracts";
/** Preserve financial values/evidence; journal rationale and authorization bindings
 * remain private to the custodian even when a question owner exports their run. */
export function publicFinancialPayment(payment:PaymentRecord):PaymentRecord {
  const keys=["id","kind","queryId","sourceId","sourceName","payer","payee","amountUsdc","offerId","listPriceUsdc","weight","txHash","network",
    "settled","settlementStatus","origin","createdAt",
    "itemId","itemTitle","itemUrl","contentVersion","itemPublishedAt","scholarlyDeclarationId","scholarlyApprovalId"] as const;
  const result:Record<string,unknown>={};for(const key of keys)if(Object.hasOwn(payment,key))result[key]=payment[key];
  return result as unknown as PaymentRecord;
}
/** Creator/payment ownership is never research ownership. Only PUBLIC questions may enrich public earnings. */
export async function listedQuestion(db:Pick<KeryxDB,"runPrivacy">,id:string):Promise<string | undefined> {
  if(!db.runPrivacy) return undefined;
  const rows=await requirePrivacy(db).list({take:1,ids:[id]});
  return rows[0]?.question;
}
/** Separate read-model schema: the immutable research-receipt v1 protocol is unchanged. */
export function settlementReceipt(run:QueryRun,payments:PaymentRecord[]) {
  const payload={schema:"urn:keryx:settlement-receipt:1",runId:run.id,createdAt:run.createdAt,
    recordedSpendUsdc:run.totalSpent,recordedCreatorAllocationUsdc:run.totalToCreators,
    payments:payments.map(publicFinancialPayment),
    qualification:"Recorded amounts and payment states; a digest is not a signature or proof of settlement."};
  canonicalJson(payload);
  return {...payload,integrity:{algorithm:"SHA-256",digest:researchReceiptDigest(payload)}};
}
