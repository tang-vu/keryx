import { BUYER_ORIGIN } from "./protocol";
import type { PrivateMerchantPolicy } from "./private-merchant-policy";
import { readPrivateBrowserJournal } from "./private-browser-journal";
import { validatePrivateBuyerResult } from "./private-result-binding";
import { checkPrivateBrowserSession } from "./private-browser-quote";
import { privateBrowserFetch } from "./private-browser-transport";
import { readBoundedJson } from "../read-bounded-json";
import type { BuyerFetch } from "./transport";

/** No wallet, signing, submission or journal mutation, including after a missing result. */
export async function recoverPrivateBrowserResearch(id: string, payer: string, merchants: PrivateMerchantPolicy,
  options: { http?: BuyerFetch; read?: typeof readPrivateBrowserJournal; signal?: AbortSignal } = {}) {
  const { http = privateBrowserFetch, read = readPrivateBrowserJournal, signal } = options;
  const saved = await read(id, payer, merchants);
  if (!saved.intent) return { status: "unsigned-reservation" as const };
  await checkPrivateBrowserSession(payer, http, signal);
  const response = await http(`${BUYER_ORIGIN}/api/me/private-jobs/result`, { method: "POST", signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
  if (response.status === 404) { void response.body?.cancel().catch(() => undefined); return { status: "not-found-uncertain" as const }; }
  if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); throw new Error("Private result recovery unavailable"); }
  const view = validatePrivateBuyerResult(await readBoundedJson(response, 16_777_216), payer, saved.intent);
  await checkPrivateBrowserSession(payer, http, signal);
  return { status: "recovered" as const, view };
}
