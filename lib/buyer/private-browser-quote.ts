import { z } from "zod";
import { addressSchema, BUYER_ORIGIN, buyerRequestSchema } from "./protocol";
import { privateMerchantPolicySchema, type PrivateMerchantPolicy } from "./private-merchant-policy";
import { acceptPrivateQuote, privateQuoteSchema } from "./private-quote";
import { privateBrowserFetch } from "./private-browser-transport";
import { readBoundedJson } from "../read-bounded-json";
import type { BuyerFetch } from "./transport";

export type PrivateBrowserLimits = { maxTotalMicros: string; maxServiceFeeMicros: string };

export async function checkPrivateBrowserSession(payer: string, http: BuyerFetch = privateBrowserFetch, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await http(`${BUYER_ORIGIN}/api/auth/session`, { method: "GET", signal });
  if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); throw new Error("Sign in with the reviewed paying wallet"); }
  const value = z.object({ session: z.object({ address: addressSchema, role: z.string().max(64) }).strict() }).strict()
    .parse(await readBoundedJson(response, 4096));
  signal?.throwIfAborted();
  if (value.session.address.toLowerCase() !== addressSchema.parse(payer).toLowerCase()) throw new Error("Signed-in account changed");
}

/** The provider policy is a proposal until the user reviews and retains this exact quote. */
export async function previewPrivateBrowserQuote(requestValue: unknown, payer: string, merchantValue: PrivateMerchantPolicy,
  limits: PrivateBrowserLimits, http: BuyerFetch = privateBrowserFetch, signal?: AbortSignal) {
  const request = buyerRequestSchema.parse(requestValue), merchants = privateMerchantPolicySchema.parse(merchantValue);
  const owner = addressSchema.parse(payer).toLowerCase();
  await checkPrivateBrowserSession(owner, http, signal);
  const response = await http(`${BUYER_ORIGIN}/api/me/private-jobs/quote`, { method: "POST", signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); throw new Error("Private quote unavailable"); }
  const envelope = z.object({ wallet: addressSchema, purchasingAvailable: z.boolean(), quote: privateQuoteSchema }).strict()
    .parse(await readBoundedJson(response, 16384));
  if (envelope.wallet.toLowerCase() !== owner) throw new Error("Private quote account mismatch");
  const expected = { ...request, access: "payer-private-v1", model: envelope.quote.request.model, reasoning: envelope.quote.request.reasoning };
  const quote = acceptPrivateQuote(envelope.quote, expected, merchants, limits);
  await checkPrivateBrowserSession(owner, http, signal);
  return { payer: owner, purchasingAvailable: envelope.purchasingAvailable, quote };
}
