import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { privateRequestSchema } from "./private-request-commitment";
import { privateMerchantPolicySchema, type PrivateMerchantPolicy } from "./private-merchant-policy";
import { addressSchema, BUYER_ORIGIN, BUYER_NETWORK, buyerTypedData } from "./protocol";
import { acceptPrivateQuote } from "./private-quote";
import { preparePrivateBuyerJournal } from "./private-checkout-preparation";
import { submitPrivateBuyerJournal } from "./private-submission";
import { withPrivateBuyerSession } from "./private-account-session";
import { buyerFetch, type BuyerFetch } from "./transport";
import { readBoundedJson } from "../read-bounded-json";

type Account = Parameters<typeof withPrivateBuyerSession>[0] & {
  signTypedData: (data: ReturnType<typeof buyerTypedData>) => Promise<`0x${string}`>;
};

/** Fresh checkout only. Independent request/price policy precedes login. An existing
 * state directory is never reused. Availability is necessary, not settlement proof. */
export async function checkoutPrivateBuyer(directory: string, requestValue: unknown,
  merchantValue: PrivateMerchantPolicy, limitValue: { maxTotalMicros: string; maxServiceFeeMicros: string },
  account: Account, http: BuyerFetch = buyerFetch) {
  const request = privateRequestSchema.refine(value => "reasoning" in value).parse(requestValue);
  const merchants = privateMerchantPolicySchema.parse(merchantValue);
  const micros = z.string().regex(/^(0|[1-9]\d{0,6})$/);
  const limits = z.object({ maxTotalMicros: micros, maxServiceFeeMicros: micros }).strict().parse(limitValue);
  const budget = BigInt(Math.round(request.budget * 1e6));
  if (BigInt(limits.maxTotalMicros) > BigInt(1_000_000) || BigInt(limits.maxTotalMicros) <= budget
    || BigInt(limits.maxServiceFeeMicros) === BigInt(0)) throw new Error("Private checkout limits unavailable");
  const owner = addressSchema.parse(account.address);
  const signer = { address: owner, signMessage: account.signMessage.bind(account), signTypedData: account.signTypedData.bind(account) };
  const state = resolve(directory);
  try { await lstat(state); throw new Error("Private checkout requires a new state directory; recover the existing job"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return withPrivateBuyerSession(signer, async cookie => {
    const { question, budget, researchMode, packageVersion, responseMode } = request;
    const response = await http(`${BUYER_ORIGIN}/api/me/private-jobs/quote`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { origin: BUYER_ORIGIN, cookie, "content-type": "application/json" },
      body: JSON.stringify({ question, budget, researchMode, packageVersion, responseMode }),
    });
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Private checkout quote unavailable");
    }
    const envelope = z.object({ wallet: addressSchema, purchasingAvailable: z.boolean(), quote: z.unknown() }).strict()
      .parse(await readBoundedJson(response, 16384));
    if (envelope.wallet.toLowerCase() !== owner.toLowerCase()) throw new Error("Private checkout owner mismatch");
    const quote = acceptPrivateQuote(envelope.quote, request, merchants, limits);
    if (!envelope.purchasingAvailable) return { network: BUYER_NETWORK, status: "checkout-unavailable" as const,
      submissionAttempted: false, paymentSignatureCreated: false, signOutConfirmed: true };
    await preparePrivateBuyerJournal(state, quote, request, merchants, limits, signer);
    const result = await submitPrivateBuyerJournal(state, owner, merchants, cookie, http);
    return { network: BUYER_NETWORK, ...result, paymentSignatureCreated: true, signOutConfirmed: true };
  }, http);
}
