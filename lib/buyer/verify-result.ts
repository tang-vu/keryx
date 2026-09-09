import { a2aResearchPackageFingerprint } from "../a2a/research-package";
import { sha256, verifyResearchReceipt } from "../research-receipt-integrity";
import type { BuyerIntent } from "./journal";
import { verifyBuyerJobBinding, verifyBuyerReceiptBinding } from "./result-binding";
export { sellerPaymentEvidence } from "./result-binding";

export function verifyBuyerJob(value: unknown, intent: BuyerIntent) {
  const { job, expectedPackage } = verifyBuyerJobBinding(value, intent);
  return { job, packageFingerprint: a2aResearchPackageFingerprint(expectedPackage) };
}

export function verifyBuyerReceipt(value: unknown, headerDigest: string | null, intent: BuyerIntent, answer: string) {
  const integrity = verifyResearchReceipt(value);
  if (!integrity.valid || headerDigest !== integrity.actualDigest) throw new Error("Receipt integrity or HTTPS response digest mismatch");
  const settlement = verifyBuyerReceiptBinding(value, intent, answer, sha256(answer));
  return { digest: integrity.actualDigest!, integrity: "verified" as const, requestBinding: "verified" as const, settlement, settlementAuthority: "Keryx ledger; not independently verified" };
}
