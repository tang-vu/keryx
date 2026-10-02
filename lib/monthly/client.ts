import { recoverTypedDataAddress, type Hex } from "viem";
import { z } from "zod";
import { browserBuyerJobId, encodeBrowserPayment } from "../buyer/browser-policy";
import { buyerTypedData, BUYER_ORIGIN, decodeHeader, requirementSchema, authorizationSchema, type BuyerAuthorization } from "../buyer/protocol";
import { browserSha256 } from "../browser-receipt-integrity";
import { MONTHLY_PATH, monthlyMessage, monthlyQuoteSchema, type MonthlyQuote } from "./protocol";

export interface MonthlyIntent { schema: "keryx-monthly-intent-v1"; monthlyId: string; quote: MonthlyQuote; authorization: BuyerAuthorization; challengeExpiresAt?: string }
export const monthlyIntentSchema = z.object({ schema: z.literal("keryx-monthly-intent-v1"), monthlyId: z.string().regex(/^monthly_[a-f0-9]{64}$/),
  quote: monthlyQuoteSchema, authorization: authorizationSchema, challengeExpiresAt: z.string().regex(/^\d+$/).optional() }).strict();
const endpoint = `${BUYER_ORIGIN}${MONTHLY_PATH}`;
type Http = typeof fetch;

export async function fetchMonthlyQuote(http: Http = fetch): Promise<MonthlyQuote> {
  const res = await http(`${endpoint}?quote=1`, { cache: "no-store" });
  if (!res.ok) throw new Error("Monthly pilot unavailable");
  return monthlyQuoteSchema.parse((await res.json()).quote);
}

/** One fresh explicit purchase. Persist an intent and submission boundary before any debit. */
export async function buyMonthly(input: { quote: MonthlyQuote; payer: string;
  readWallet: () => Promise<{ address: string; chainId: number; gatewayBalanceMicros: string }>;
  sign: (authorization: BuyerAuthorization) => Promise<Hex>;
  prepare: (intent: MonthlyIntent) => Promise<void>; claim: (intent: MonthlyIntent) => Promise<void> }, http: Http = fetch) {
  const quote = monthlyQuoteSchema.parse(input.quote);
  const response = await http(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-keryx-monthly-payer": input.payer }, body: JSON.stringify(quote) });
  if (response.status !== 402) { await response.body?.cancel(); throw new Error("Monthly quote changed or unavailable"); }
  const challenge = z.object({ x402Version: z.literal(2), resource: z.object({ url: z.string() }), accepts: z.array(requirementSchema).length(1) }).parse(decodeHeader(response.headers.get("payment-required")));
  await response.body?.cancel();
  const requirement = challenge.accepts[0];
  const authorization = authorizationSchema.parse(JSON.parse(response.headers.get("x-keryx-monthly-authorization") ?? "null"));
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const challengeExpiresAt = z.string().regex(/^\d+$/).parse(response.headers.get("x-keryx-monthly-expires"));
  if (authorization.from.toLowerCase() !== input.payer.toLowerCase() || authorization.to.toLowerCase() !== quote.payee.toLowerCase()
    || authorization.value !== String(quote.totalMicros) || BigInt(authorization.validAfter) > nowSeconds
    || BigInt(authorization.validAfter) < nowSeconds - BigInt(660) || BigInt(authorization.validBefore) < nowSeconds + BigInt(604800)
    || BigInt(authorization.validBefore) > nowSeconds + BigInt(requirement.maxTimeoutSeconds + 60)
    || BigInt(challengeExpiresAt) <= nowSeconds || BigInt(challengeExpiresAt) > nowSeconds + BigInt(660)) throw new Error("Monthly issued authorization mismatch");
  if (![endpoint, MONTHLY_PATH].includes(challenge.resource.url) || requirement.payTo.toLowerCase() !== quote.payee.toLowerCase()
    || requirement.amount !== String(quote.totalMicros)) throw new Error("Monthly payment challenge mismatch");
  const check = async () => { const wallet = await input.readWallet();
    if (wallet.address.toLowerCase() !== input.payer.toLowerCase() || wallet.chainId !== 5042002 || BigInt(wallet.gatewayBalanceMicros) < BigInt(requirement.amount)) throw new Error("Check the reviewed wallet and Gateway funds"); };
  await check();
  const monthlyId = (await browserBuyerJobId(authorization)).replace(/^a2a_/, "monthly_");
  const intent: MonthlyIntent = { schema: "keryx-monthly-intent-v1", monthlyId, quote, authorization, challengeExpiresAt };
  await input.prepare(intent);
  await check();
  const signature = await input.sign(authorization);
  if ((await recoverTypedDataAddress({ ...buyerTypedData(authorization), signature })).toLowerCase() !== input.payer.toLowerCase()) throw new Error("Wrong Monthly wallet signature");
  await check();
  if (BigInt(challengeExpiresAt) <= BigInt(Math.floor(Date.now()/1000))) throw new Error("Monthly challenge expired before submission");
  await input.claim(intent);
  // After this durable boundary every transport/storage failure is uncertain. Never retry a debit.
  try {
    const paid = await http(endpoint, { method: "POST", headers: { "content-type": "application/json", "payment-signature": encodeBrowserPayment({ signature, authorization }), "x-keryx-monthly-expires": challengeExpiresAt }, body: JSON.stringify(quote) });
    const evidence = z.object({ success: z.literal(true), transaction: z.string().min(1), payer: z.string(), network: z.literal("eip155:5042002") }).parse(decodeHeader(paid.headers.get("payment-response")));
    const body = await paid.json();
    if (!paid.ok || evidence.payer.toLowerCase() !== input.payer.toLowerCase() || body.monthlyId !== monthlyId
      || body.purchase?.transaction !== evidence.transaction || body.purchase?.totalMicros !== quote.totalMicros
      || body.purchase?.quoteId !== quote.quoteId) throw new Error("Monthly acknowledgement mismatch");
    return { monthlyId, status: "seller_reported_settled" as const, evidence };
  } catch { return { monthlyId, status: "submission_uncertain" as const }; }
}

export async function monthlyStatus(monthlyId: string, payer: string, signMessage: (message: string) => Promise<Hex>, http: Http = fetch) {
  const timestamp = Date.now(); const payload = { monthlyId };
  const signature = await signMessage(monthlyMessage("status", payload, timestamp));
  const res = await http(`${endpoint}?id=${encodeURIComponent(monthlyId)}`, { headers: {
    "x-keryx-monthly-proof": JSON.stringify({ payer, timestamp, signature }) }, cache: "no-store" });
  if (!res.ok) throw new Error("Plan not found or wallet proof refused. An uncertain payment must not be repeated.");
  return res.json();
}

export async function submitMonthly(input: { monthlyId: string; requestId: string; question: string; payer: string }, signMessage: (message: string) => Promise<Hex>, http: Http = fetch) {
  const timestamp = Date.now();
  const questionDigest = (await browserSha256(input.question)).slice(7);
  const signature = await signMessage(monthlyMessage("redeem", { monthlyId: input.monthlyId, requestId: input.requestId, questionDigest }, timestamp));
  const res = await http(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
    monthlyId: input.monthlyId, requestId: input.requestId, question: input.question, proof: { payer: input.payer, timestamp, signature } }) });
  if (!res.ok) throw new Error("Request refused or unavailable. Recover the same request ID and question; do not create another request to recover it.");
  return res.json();
}
