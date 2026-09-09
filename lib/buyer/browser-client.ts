import { recoverTypedDataAddress, type Hex } from "viem";
import { z } from "zod";
import { BUYER_ENDPOINT, BUYER_ORIGIN, addressSchema, buyerRequestSchema, buyerTypedData, type BuyerRequest, type BuyerAuthorization, type BuyerIntentEnvelope } from "./protocol";
import { browserBuyerJobId, browserNewAuthorization, encodeBrowserPayment } from "./browser-policy";
import { createBrowserJournal, claimBrowserSubmission, readBrowserJournal, saveBrowserAcknowledgement } from "./browser-journal";
import { quoteBuyer } from "./quote";
import { buyerFetch, readBuyerJson, type BuyerFetch } from "./transport";
import { sellerPaymentEvidence, validateSellerEvidence } from "./result-binding";
import { verifyBrowserBuyerJob, verifyBrowserBuyerReceipt } from "./browser-result";

const walletSchema = z.object({ address: addressSchema, chainId: z.literal(5042002),
  gatewayBalanceMicros: z.string().regex(/^(0|[1-9]\d{0,77})$/) });
export type BrowserBuyerWallet = z.infer<typeof walletSchema>;
const journal = { create: createBrowserJournal, claim: claimBrowserSubmission, read: readBrowserJournal, acknowledge: saveBrowserAcknowledgement };
export type BrowserBuyerStorage = typeof journal;

/** One explicit fresh purchase. Recovery/import never calls this function. */
export async function buyBrowserResearch(input: {
  request: BuyerRequest; payee: string; payer: string; acceptedTotalMicros: string;
  readWallet: () => Promise<BrowserBuyerWallet>;
  sign: (authorization: BuyerAuthorization) => Promise<Hex>;
  onPrepared: (intent: BuyerIntentEnvelope) => void | Promise<void>;
  signal?: AbortSignal;
}, dependencies: { http?: BuyerFetch; storage?: BrowserBuyerStorage } = {}) {
  const { http = buyerFetch, storage = journal } = dependencies;
  const request = buyerRequestSchema.parse(input.request);
  const payer = addressSchema.parse(input.payer);
  const acceptedTotalMicros = input.acceptedTotalMicros;
  input.signal?.throwIfAborted();
  const requirement = await quoteBuyer(request, input.payee, acceptedTotalMicros, http, input.signal);
  // A lower price is also a changed review: never silently sign a different total.
  if (requirement.amount !== acceptedTotalMicros) throw new Error("Price changed; review a fresh quote before buying");
  const checkWallet = async () => {
    input.signal?.throwIfAborted();
    const wallet = walletSchema.parse(await input.readWallet());
    input.signal?.throwIfAborted();
    if (wallet.address.toLowerCase() !== payer.toLowerCase()) throw new Error("Connected wallet changed; review the purchase again");
    if (BigInt(wallet.gatewayBalanceMicros) < BigInt(requirement.amount)) throw new Error("Insufficient Gateway balance for this purchase");
  };
  await checkWallet();
  const authorization = browserNewAuthorization(payer, requirement);
  const intent: BuyerIntentEnvelope = { schema: "keryx-buyer-intent-v1", request, requirement, authorization, queryId: await browserBuyerJobId(authorization) };
  await storage.create(intent);
  // Expose the private recovery file before a wallet prompt can create a signature.
  await input.onPrepared(structuredClone(intent));
  await checkWallet();
  const signature = await input.sign(structuredClone(authorization));
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)
    || (await recoverTypedDataAddress({ ...buyerTypedData(authorization), signature })).toLowerCase() !== payer.toLowerCase()) {
    throw new Error("Signature does not match the reviewed wallet and authorization");
  }
  await checkWallet();
  if (!await storage.claim(intent)) throw new Error("This job is recovery-only; do not submit payment again");
  // Every failure after the committed boundary is uncertain, even if no POST reached the seller.
  let evidence: ReturnType<typeof sellerPaymentEvidence> = null;
  let acknowledgementPersisted = false;
  try {
    const response = await http(BUYER_ENDPOINT, { method: "POST", headers: { "content-type": "application/json",
      "payment-signature": encodeBrowserPayment({ signature, authorization }) }, body: JSON.stringify(request), signal: input.signal });
    try {
      evidence = sellerPaymentEvidence(response.headers.get("payment-response"), intent);
      await storage.acknowledge(intent, { httpStatus: response.status, evidence });
      acknowledgementPersisted = true;
      if (response.ok && evidence) return { queryId: intent.queryId, status: "submitted" as const, evidence, acknowledgementPersisted };
    } finally { await response.body?.cancel(); }
  } catch { /* No retry of the payment, including when storing the acknowledgement failed. */ }
  return { queryId: intent.queryId, status: "submission_uncertain" as const, evidence, acknowledgementPersisted };
}

/** Wallet-free GET recovery. A missing job or receipt never authorizes another payment. */
export async function resumeBrowserResearch(queryId: string, options: {
  http?: BuyerFetch; storage?: BrowserBuyerStorage; signal?: AbortSignal;
} = {}) {
  const { http = buyerFetch, storage = journal, signal } = options;
  const saved = await storage.read(queryId);
  const intent = saved.intent;
  const evidence = validateSellerEvidence(saved.acknowledgement?.evidence, intent);
  const payment = { state: evidence ? "seller_reported_settled" as const : "unconfirmed" as const, evidence };
  signal?.throwIfAborted();
  const response = await http(`${BUYER_ENDPOINT}?queryId=${intent.queryId}`, { method: "GET", headers: { accept: "application/json" }, signal });
  if (response.status === 404) {
    await response.body?.cancel();
    return { queryId: intent.queryId, status: "not_found_uncertain" as const, payment };
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error("Job lookup unavailable; recover the same job later"); }
  const { job, packageFingerprint } = await verifyBrowserBuyerJob(await readBuyerJson(response), intent);
  if (job.status !== "completed") return { ...job, packageFingerprint, payment };
  const receiptResponse = await http(`${BUYER_ORIGIN}/api/dispatch/${intent.queryId}/receipt`, { method: "GET", headers: { accept: "application/json" }, signal });
  if (!receiptResponse.ok) { await receiptResponse.body?.cancel(); throw new Error("Receipt unavailable; recover the same job later"); }
  const receipt: unknown = await readBuyerJson(receiptResponse);
  const verification = await verifyBrowserBuyerReceipt(receipt, receiptResponse.headers.get("x-keryx-receipt-digest"), intent, job.answer!);
  return { ...job, packageFingerprint, payment, verification, receipt };
}
