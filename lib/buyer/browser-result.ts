import { a2aPackageFingerprintInput } from "../a2a/research-package-definition";
import { browserSha256, verifyBrowserReceipt } from "../browser-receipt-integrity";
import { buyerIntentEnvelopeSchema, type BuyerIntentEnvelope } from "./protocol";
import { browserBuyerJobId } from "./browser-policy";
import { verifyBuyerJobBinding, verifyBuyerReceiptBinding } from "./result-binding";

/** Imported browser journals are read-only recovery inputs, never signing permission. */
export async function verifyBrowserIntent(value: unknown): Promise<BuyerIntentEnvelope> {
  const intent = buyerIntentEnvelopeSchema.parse(value);
  if (intent.queryId !== await browserBuyerJobId(intent.authorization)
    || intent.authorization.value !== intent.requirement.amount
    || intent.authorization.to.toLowerCase() !== intent.requirement.payTo.toLowerCase()) {
    throw new Error("Journal authorization does not match its job");
  }
  return intent;
}

export async function verifyBrowserBuyerJob(value: unknown, intent: BuyerIntentEnvelope) {
  const { job, expectedPackage } = verifyBuyerJobBinding(value, intent);
  const fingerprint = await browserSha256(a2aPackageFingerprintInput(expectedPackage));
  return { job, packageFingerprint: fingerprint.slice(7) };
}

export async function verifyBrowserBuyerReceipt(value: unknown, headerDigest: string | null, intent: BuyerIntentEnvelope, answer: string) {
  const integrity = await verifyBrowserReceipt(value);
  if (!integrity.valid || headerDigest !== integrity.actualDigest) throw new Error("Receipt integrity or HTTPS response digest mismatch");
  const settlement = verifyBuyerReceiptBinding(value, intent, answer, await browserSha256(answer));
  return { digest: integrity.actualDigest!, integrity: "verified" as const, requestBinding: "verified" as const, settlement, settlementAuthority: "Keryx ledger; not independently verified" };
}
