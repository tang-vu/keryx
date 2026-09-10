import { z } from "zod";
import { claimPrivateBuyerSubmission } from "./private-journal";
import { privateMerchantPolicySchema, type PrivateMerchantPolicy } from "./private-merchant-policy";
import { PRIVATE_RESEARCH_RESOURCE } from "./private-request-commitment";
import { BUYER_ORIGIN } from "./protocol";
import { buyerFetch, type BuyerFetch } from "./transport";
import { readBoundedJson } from "../read-bounded-json";

const responseSchema = z.object({ id: z.string(), paymentStatus: z.enum([
  "pending", "settled", "verification-rejected", "capacity-unavailable", "confirmation-unpersisted",
]) }).strict();

/** One signed submission from an existing journal and an already authenticated owner
 * session. No signing, funding, redirect, retry or public endpoint fallback. An attempt
 * marker is permanent even for HTTP errors: recovery reads, never resubmits. This
 * internal transport does not activate the private purchase route. */
export async function submitPrivateBuyerJournal(directory: string, payer: string, merchants: PrivateMerchantPolicy,
  sessionCookie: string, http: BuyerFetch = buyerFetch, now = Date.now()) {
  const cookie = z.string().max(8192).regex(/^keryx_session=[A-Za-z0-9._-]+$/).safeParse(sessionCookie);
  if (!cookie.success || !Number.isSafeInteger(now) || now < 0) throw new Error("Private submission context unavailable");
  let claim;
  try { claim = await claimPrivateBuyerSubmission(directory, payer, privateMerchantPolicySchema.parse(merchants)); }
  catch { throw new Error("Private submission journal unavailable"); }
  if (!claim.claimed) return { status: "recovery-required" as const, submissionAttempted: false };
  const authorization = claim.intent.submission.payment.authorization;
  const seconds = BigInt(Math.floor(now / 1000));
  if (seconds <= BigInt(authorization.validAfter) || seconds >= BigInt(authorization.validBefore))
    return { status: "not-sent" as const, reason: "authorization-not-current" as const, submissionAttempted: false };
  try {
    const response = await http(PRIVATE_RESEARCH_RESOURCE, { method: "POST", redirect: "error", cache: "no-store",
      headers: { origin: BUYER_ORIGIN, "content-type": "application/json", cookie: cookie.data },
      body: JSON.stringify(claim.intent.submission), signal: AbortSignal.timeout(30000) });
    if (response.status !== 200 && response.status !== 202) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error();
    }
    const result = responseSchema.parse(await readBoundedJson(response, 4096));
    if (result.id !== claim.intent.id) throw new Error();
    return { status: "response-received" as const, submissionAttempted: true,
      evidence: "server-reported" as const, paymentStatus: result.paymentStatus };
  } catch {
    // A timeout, rejection or malformed response never establishes failure or a refund.
    return { status: "recovery-required" as const, submissionAttempted: true };
  }
}
