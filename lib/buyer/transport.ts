import { BUYER_ORIGIN } from "./policy";

export type BuyerFetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Never forward a payment signature through a redirect or to another origin. */
export async function buyerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (new URL(url).origin !== BUYER_ORIGIN) throw new Error("Untrusted buyer destination");
  return fetch(url, { ...init, redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(30_000) });
}

export async function readBuyerJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new Error("Buyer response exceeds 2 MB");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
