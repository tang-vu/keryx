import { readBoundedJson } from "../read-bounded-json";
import { PURCHASE_OUTCOMES_MAX_BYTES, purchaseOutcomeId, validatePurchaseOutcomes } from "./purchase-outcomes-contract";

/** Public-only GET. Never supplies API keys, cookies, payment or authorization. */
export async function fetchPurchaseOutcomes(origin: string, id: string, signal?: AbortSignal) {
  purchaseOutcomeId.parse(id);
  if (typeof origin !== "string" || origin.length > 2048 || /[\s\u0000-\u001f\u007f\\]/u.test(origin)) throw new Error("Outcome origin refused");
  const base = new URL(origin);
  if (base.origin !== origin || base.username || base.password || base.protocol !== "https:" &&
    !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("Outcome origin refused");
  const response = await fetch(`${origin}/api/dispatch/${id}/purchase-outcomes`, { method: "GET", cache: "no-store",
    credentials: "omit", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new Error("Recorded purchase outcomes unavailable");
  return validatePurchaseOutcomes(await readBoundedJson(response, PURCHASE_OUTCOMES_MAX_BYTES), id);
}
