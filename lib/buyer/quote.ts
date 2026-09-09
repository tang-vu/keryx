import { BUYER_ENDPOINT, BuyerRefusal, buyerRequestSchema, chooseRequirement, type BuyerRequest } from "./protocol";
import { buyerFetch, type BuyerFetch } from "./transport";

export async function quoteBuyer(request: BuyerRequest, payee: string, maxTotalMicros: string, http: BuyerFetch = buyerFetch, signal?: AbortSignal) {
  const normalized = buyerRequestSchema.parse(request);
  const response = await http(BUYER_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(normalized), signal });
  try {
    if (response.status !== 402) throw new BuyerRefusal(`SKIP: expected an unpaid quote; received HTTP ${response.status}`);
    try { return chooseRequirement(response.headers.get("payment-required"), normalized, payee, maxTotalMicros); }
    catch { throw new BuyerRefusal("SKIP: challenge does not uniquely match the pinned resource, network, token, payee, signing domain, validity and total-price limit"); }
  } finally { await response.body?.cancel(); }
}
