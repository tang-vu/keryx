import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY, buyerRequestSchema, type BuyerRequest } from "../buyer/protocol";
import { privateRequestSchema } from "../buyer/private-request-commitment";
import { privateRuntimePolicy } from "./private-runtime-policy";
import { createPrivateQuote } from "./private-quote";
import { admitPrivateResearch } from "./admit-private-research";
import { submitPrivateIncomingPayment, type privateIncomingFacilitator } from "../payments/private-incoming-payment";

/** Backend composition, not an enabled HTTP route. The HTTP layer must authenticate the
 * payer and enforce origin/body limits. All prices, merchants and provider policy come
 * from a validated snapshot; caller-supplied payment requirements are never trusted. */
export function privateResearchService(db: KeryxDB, env: Parameters<typeof privateRuntimePolicy>[0],
  context: Parameters<typeof privateRuntimePolicy>[1], operations: { facilitator?: typeof privateIncomingFacilitator; now?: () => number } = {}) {
  const policy = privateRuntimePolicy(env, context);
  if (!policy) return null;
  const { facilitator, now } = operations;
  function quote(input: unknown) {
    const request = buyerRequestSchema.parse(input);
    const amount = (BigInt(Math.round(request.budget * 1e6)) + BigInt(policy!.serviceFeeMicros)).toString();
    return createPrivateQuote(request, { provider: policy!.provider, merchants: policy!.merchants,
      requirement: { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount, payTo: policy!.merchants.privatePayee,
        maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } } });
  }
  return {
    quote,
    async submit(submission: unknown, authenticatedPayer: string) {
      const signed = z.object({ request: privateRequestSchema }).parse(submission).request;
      const input: BuyerRequest = { question: signed.question, budget: signed.budget, researchMode: signed.researchMode,
        packageVersion: signed.packageVersion, responseMode: signed.responseMode };
      const expected = quote(input);
      const admitted = await admitPrivateResearch(db, submission, authenticatedPayer,
        { provider: policy.provider, merchants: policy.merchants, requirement: expected.requirement });
      const payment = await submitPrivateIncomingPayment(db, admitted.id, authenticatedPayer,
        { treasury: policy.treasury, facilitator, now: now?.() });
      // Only response is suitable for the authenticated HTTP response. Keep known success
      // available to backend persistence recovery instead of discarding it on a DB outage.
      return { response: { id: admitted.id, paymentStatus: payment.status },
        recoveryConfirmation: payment.status === "confirmation-unpersisted" ? payment.confirmation : null };
    },
  };
}
