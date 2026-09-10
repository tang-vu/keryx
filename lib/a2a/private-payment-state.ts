import { z } from "zod";
import { addressSchema, BUYER_NETWORK } from "../buyer/protocol";
import type { PrivateResearchIntent } from "./private-research-intent";

/** Internal adapter evidence, never a receipt accepted from a caller's request body. */
const confirmationFields = {
  transaction: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  network: z.literal(BUYER_NETWORK),
  payer: addressSchema, payee: addressSchema,
  amountMicros: z.string().regex(/^[1-9]\d{0,6}$/),
  authorizationId: z.string().regex(/^0x[a-f0-9]{64}$/),
};
const confirmationSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("circle-facilitator-success"), ...confirmationFields }).strict(),
  z.object({ source: z.literal("circle-transfer-search"), ...confirmationFields,
    transferStatus: z.enum(["confirmed", "completed"]) }).strict(),
]);
export type PrivatePaymentConfirmation = z.infer<typeof confirmationSchema>;
export type PrivatePaymentState = {
  id: string;
  startedAt: string;
} & ({ status: "pending"; confirmation: null; settledAt: null } | {
  status: "settled"; confirmation: PrivatePaymentConfirmation; settledAt: string;
});

/** Tuple binding only. The backend must obtain success from its trusted facilitator call. */
export function privatePaymentConfirmation(value: unknown, intent: PrivateResearchIntent): PrivatePaymentConfirmation {
  try {
    const confirmation = confirmationSchema.parse(value);
    const authorization = intent.submission.payment.authorization;
    if (confirmation.payer.toLowerCase() !== authorization.from || confirmation.payee.toLowerCase() !== authorization.to
      || confirmation.amountMicros !== authorization.value || confirmation.authorizationId !== authorization.nonce) throw new Error("Mismatch");
    return { ...confirmation, payer: confirmation.payer.toLowerCase(), payee: confirmation.payee.toLowerCase() };
  } catch { throw new Error("Private payment confirmation mismatch"); }
}

export function privatePaymentState(row: { started_at: unknown; settled_at: unknown; confirmation: unknown }, intent: PrivateResearchIntent): PrivatePaymentState {
  const date = z.string().datetime({ offset: true });
  try {
    const startedAt = date.parse(row.started_at);
    if (row.confirmation === null && row.settled_at === null) return { id: intent.id, startedAt, status: "pending", confirmation: null, settledAt: null };
    const settledAt = date.parse(row.settled_at);
    const confirmation = privatePaymentConfirmation(row.confirmation, intent);
    return { id: intent.id, startedAt, status: "settled", confirmation, settledAt };
  } catch { throw new Error("Invalid private payment state"); }
}

export function requirePrivatePaymentConfirmation(state: PrivatePaymentState | null, expected: PrivatePaymentConfirmation) {
  if (state?.status !== "settled" || JSON.stringify(state.confirmation) !== JSON.stringify(expected)) throw new Error("Private payment confirmation conflict");
  return state;
}
