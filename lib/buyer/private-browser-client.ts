import { z } from "zod";
import { addressSchema, type BuyerAuthorization } from "./protocol";
import { privateMerchantPolicySchema, type PrivateMerchantPolicy } from "./private-merchant-policy";
import { acceptPrivateQuote } from "./private-quote";
import { createPrivateAuthorization, PRIVATE_RESEARCH_RESOURCE } from "./private-request-commitment";
import { privateBrowserDraftId } from "./private-browser-draft";
import { reservePrivateBrowserJournal, savePrivateBrowserSignature, claimPrivateBrowserSubmission } from "./private-browser-journal";
import { validatePrivateBuyerIntent } from "./private-buyer-intent";
import { previewPrivateBrowserQuote, checkPrivateBrowserSession, type PrivateBrowserLimits } from "./private-browser-quote";
import { privateBrowserFetch } from "./private-browser-transport";
import { canonicalJson } from "../canonical-json";
import { readBoundedJson } from "../read-bounded-json";
import type { BuyerFetch } from "./transport";

const walletSchema = z.object({ address: addressSchema, chainId: z.literal(5042002),
  gatewayBalanceMicros: z.string().regex(/^(0|[1-9]\d{0,30})$/) }).strict();
const responseSchema = z.object({ id: z.string(), paymentStatus: z.enum([
  "pending", "settled", "verification-rejected", "capacity-unavailable", "confirmation-unpersisted",
]) }).strict();
const storage = { reserve: reservePrivateBrowserJournal, saveSignature: savePrivateBrowserSignature, claim: claimPrivateBrowserSubmission };
export type PrivateBrowserStorage = typeof storage;

/** One explicitly reviewed NEW purchase. Import/reload/recovery must never call this function. */
export async function buyPrivateBrowserResearch(input: {
  request: unknown; acceptedQuote: unknown; payer: string; merchants: PrivateMerchantPolicy; limits: PrivateBrowserLimits;
  localStorageAccepted: boolean;
  readWallet: () => Promise<unknown>;
  sign: (authorization: BuyerAuthorization) => Promise<`0x${string}`>;
  onReserved: (id: string) => void | Promise<void>;
  signal?: AbortSignal;
}, dependencies: { http?: BuyerFetch; journal?: PrivateBrowserStorage; now?: () => number } = {}) {
  if (input.localStorageAccepted !== true) throw new Error("Accept local storage of private research before buying");
  const { http = privateBrowserFetch, journal = storage, now = Date.now } = dependencies;
  const payer = addressSchema.parse(input.payer).toLowerCase(), merchants = privateMerchantPolicySchema.parse(input.merchants);
  const accepted = acceptPrivateQuote(input.acceptedQuote, input.request, merchants, input.limits);
  const { question, budget, researchMode, packageVersion, responseMode } = accepted.request;
  const current = await previewPrivateBrowserQuote({ question, budget, researchMode, packageVersion, responseMode }, payer, merchants, input.limits, http, input.signal);
  if (!current.purchasingAvailable) throw new Error("Private purchasing is unavailable for this account");
  if (canonicalJson(current.quote) !== canonicalJson(accepted)) throw new Error("Private terms changed; review a fresh quote");
  const checkWallet = async () => {
    input.signal?.throwIfAborted();
    const wallet = walletSchema.parse(await input.readWallet());
    input.signal?.throwIfAborted();
    if (wallet.address.toLowerCase() !== payer || BigInt(wallet.gatewayBalanceMicros) < BigInt(accepted.requirement.amount))
      throw new Error("Reviewed wallet or available Gateway balance changed");
    await checkPrivateBrowserSession(payer, http, input.signal);
  };
  await checkWallet();
  const fresh = await createPrivateAuthorization(accepted.request, accepted.requirement, payer, merchants, now());
  const id = await privateBrowserDraftId(accepted.requirement, fresh.authorization);
  await journal.reserve({ ...fresh, id, requirement: accepted.requirement, resource: PRIVATE_RESEARCH_RESOURCE }, payer, merchants);
  await input.onReserved(id);
  await checkWallet();
  const signature = await input.sign(structuredClone(fresh.authorization));
  // Preserve the original signature even if the wallet prompt outlived the UI cancellation.
  const intent = await validatePrivateBuyerIntent({ schema: "keryx-private-buyer-intent-v1", id,
    resource: PRIVATE_RESEARCH_RESOURCE, requirement: accepted.requirement,
    submission: { request: fresh.request, salt: fresh.salt, payment: { authorization: fresh.authorization, signature } } }, payer, merchants);
  await journal.saveSignature(intent, payer, merchants);
  await checkWallet();
  if (!await journal.claim(intent, payer, merchants)) return { id, status: "recovery-required" as const, submissionAttempted: false };
  // A permanent marker now exists. Nothing below can authorize a second attempt.
  let submissionAttempted = false;
  try {
    input.signal?.throwIfAborted();
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error();
    const seconds = BigInt(Math.floor(timestamp / 1000)), authorization = intent.submission.payment.authorization;
    if (seconds <= BigInt(authorization.validAfter) || seconds >= BigInt(authorization.validBefore)) throw new Error();
    submissionAttempted = true;
    const response = await http(PRIVATE_RESEARCH_RESOURCE, { method: "POST", signal: input.signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify(intent.submission) });
    if (response.status !== 200 && response.status !== 202) { void response.body?.cancel().catch(() => undefined); throw new Error(); }
    const result = responseSchema.parse(await readBoundedJson(response, 4096));
    if (result.id !== id) throw new Error();
    return { id, status: "response-received" as const, submissionAttempted: true,
      evidence: "server-reported" as const, paymentStatus: result.paymentStatus };
  } catch {
    return { id, status: "recovery-required" as const, submissionAttempted };
  }
}
