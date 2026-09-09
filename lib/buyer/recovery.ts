import { z } from "zod";
import { buyerIntentEnvelopeSchema, type BuyerIntentEnvelope } from "./protocol";
import { sellerEvidenceSchema, validateSellerEvidence } from "./result-binding";

export const RECOVERY_MAX_BYTES = 65536;
const portableEvidenceSchema = sellerEvidenceSchema.extend({
  authority: z.literal("seller-relayed-payment-response").optional(),
  independentlyVerified: z.literal(false).optional(),
}).strict().transform(value => sellerEvidenceSchema.parse(value));
export const paymentAcknowledgementSchema = z.object({
  httpStatus: z.number().int().min(100).max(599),
  evidence: portableEvidenceSchema.nullable(),
}).strict();
export type PaymentAcknowledgement = z.infer<typeof paymentAcknowledgementSchema>;

const recoverySchema = z.object({
  schema: z.literal("keryx-buyer-recovery-v1"),
  intent: buyerIntentEnvelopeSchema,
  acknowledgement: paymentAcknowledgementSchema.optional(),
}).strict();

/** Structural validation only; each runtime must also recompute the original job ID.
 * Copied acknowledgements remain unverified seller assertions, not payment authority.
 * No signature, submission permission, URL override or private key is portable.
 */
export function parseBuyerRecovery(text: string) {
  if (new TextEncoder().encode(text).length > RECOVERY_MAX_BYTES) throw new Error("Recovery file exceeds 64 KB");
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  const legacy = buyerIntentEnvelopeSchema.safeParse(value);
  const recovery = legacy.success
    ? recoverySchema.parse({ schema: "keryx-buyer-recovery-v1", intent: legacy.data })
    : recoverySchema.parse(value);
  if (recovery.acknowledgement?.evidence && !validateSellerEvidence(recovery.acknowledgement.evidence, recovery.intent)) {
    throw new Error("Recovery acknowledgement has a different payer or network");
  }
  return recovery;
}

export function encodeBuyerRecovery(intent: BuyerIntentEnvelope, acknowledgement?: PaymentAcknowledgement): string {
  const text = JSON.stringify({ schema: "keryx-buyer-recovery-v1", intent, acknowledgement });
  const encoded = JSON.stringify(parseBuyerRecovery(text), null, 2) + "\n";
  if (new TextEncoder().encode(encoded).length > RECOVERY_MAX_BYTES) throw new Error("Recovery file exceeds 64 KB");
  return encoded;
}
