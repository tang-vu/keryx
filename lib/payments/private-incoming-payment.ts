import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { PRIVATE_RESEARCH_RESOURCE } from "../buyer/private-request-commitment";
import { privatePaymentConfirmation } from "../a2a/private-payment-state";
import { BUYER_NETWORK, addressSchema } from "../buyer/protocol";
import { readBoundedJson } from "../read-bounded-json";

const facilitatorUrl = "https://gateway-api-testnet.circle.com/v1/x402/";
type PaymentBody = { paymentPayload: unknown; paymentRequirements: unknown };
/** Explicit fixed testnet transport. No redirects, retries, discovery metadata or raw error logging. */
export async function privateIncomingFacilitator(action: "verify" | "settle", body: PaymentBody) {
  const response = await fetch(`${facilitatorUrl}${action}`, { method: "POST", redirect: "error",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Private payment facilitator unavailable"); }
  return readBoundedJson(response, 65536);
}

/** Operates only on an already verified, durable intent. The caller must authenticate its payer
 * and finish quote/provider/merchant admission before reserving it. No research is executed here.
 * Returned confirmation is backend evidence for persistence recovery, never a bearer payload. */
export async function submitPrivateIncomingPayment(db: KeryxDB, id: string, payer: string, options: {
  facilitator?: typeof privateIncomingFacilitator; now?: number;
} = {}) {
  const facilitator = options.facilitator ?? privateIncomingFacilitator;
  const now = options.now ?? Date.now();
  const intent = await db.getPrivateResearchIntent(id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const previous = await db.getPrivatePaymentState(id, payer);
  if (previous) return { status: previous.status, confirmation: previous.confirmation };
  if (!("reasoning" in intent.submission.request)) throw new Error("Provider-bound private intent required");
  const authorization = intent.submission.payment.authorization;
  if (!Number.isSafeInteger(now) || now < 0 || BigInt(Math.floor(now / 1000)) <= BigInt(authorization.validAfter)
    || BigInt(Math.floor(now / 1000)) >= BigInt(authorization.validBefore)) throw new Error("Private authorization is not currently valid");
  // Never send the question, salt, private job identifier or reasoning disclosure to Circle.
  const body = { paymentPayload: { x402Version: 2, resource: { url: PRIVATE_RESEARCH_RESOURCE,
    description: "Private research job", mimeType: "application/json" }, accepted: intent.requirement,
    payload: intent.submission.payment }, paymentRequirements: intent.requirement };
  let verification: unknown;
  try { verification = await facilitator("verify", structuredClone(body)); }
  catch { throw new Error("Private payment verification unavailable"); }
  const verified = z.object({ isValid: z.literal(true), payer: addressSchema }).safeParse(verification);
  if (!verified.success || verified.data.payer.toLowerCase() !== authorization.from) return { status: "verification-rejected" as const, confirmation: null };
  const claim = await db.claimPrivatePaymentSubmission(id, payer);
  if (!claim.claimed) return { status: claim.state.status, confirmation: claim.state.confirmation };
  let confirmation;
  try {
    const settled = z.object({ success: z.literal(true), payer: addressSchema, network: z.literal(BUYER_NETWORK), transaction: z.string() })
      .parse(await facilitator("settle", body));
    confirmation = privatePaymentConfirmation({ source: "circle-facilitator-success", transaction: settled.transaction,
      network: settled.network, payer: settled.payer, payee: authorization.to, amountMicros: authorization.value,
      authorizationId: authorization.nonce }, intent);
  } catch { return { status: "pending" as const, confirmation: null }; }
  try {
    const stored = await db.confirmPrivatePayment(id, payer, confirmation);
    return { status: stored.status, confirmation: stored.confirmation };
  } catch { return { status: "confirmation-unpersisted" as const, confirmation }; }
}
