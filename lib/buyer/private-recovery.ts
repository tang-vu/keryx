import { z } from "zod";
import { readPrivateBuyerJournal } from "./private-journal";
import type { PrivateMerchantPolicy } from "./private-merchant-policy";
import { BUYER_ORIGIN } from "./protocol";
import { buyerFetch, type BuyerFetch } from "./transport";
import { readBoundedJson } from "../read-bounded-json";
import { validatePrivateBuyerResult } from "./private-result-binding";

/** Node buyer recovery using an existing live account session. No login, signature,
 * submission retry or journal mutation. The returned view is server-reported evidence,
 * not a portable cryptographic receipt or independent chain-finality verification. */
export async function recoverPrivateBuyerResult(directory: string, payer: string, merchants: PrivateMerchantPolicy,
  sessionCookie: string, http: BuyerFetch = buyerFetch) {
  const parsedCookie = z.string().max(8192).regex(/^keryx_session=[A-Za-z0-9._-]+$/).safeParse(sessionCookie);
  if (!parsedCookie.success) throw new Error("Private result recovery requires a valid session cookie");
  const cookie = parsedCookie.data;
  const intent = await readPrivateBuyerJournal(directory, payer, merchants);
  let response: Response;
  try {
    response = await http(`${BUYER_ORIGIN}/api/me/private-jobs/result`, { method: "POST", redirect: "error", cache: "no-store",
      headers: { origin: BUYER_ORIGIN, "content-type": "application/json", cookie }, body: JSON.stringify({ id: intent.id }),
      signal: AbortSignal.timeout(30_000) });
  } catch { throw new Error("Private result recovery unavailable"); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401) throw new Error("Private result recovery requires a live account session");
    if (response.status === 404) throw new Error("Private result unavailable for this account");
    throw new Error("Private result recovery unavailable");
  }
  return validatePrivateBuyerResult(await readBoundedJson(response, 16_777_216), payer, intent);
}
