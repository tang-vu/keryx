import { BUYER_ORIGIN } from "./policy";

export type BuyerFetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Never forward a payment signature through a redirect or to another origin. */
export async function buyerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (new URL(url).origin !== BUYER_ORIGIN) throw new Error("Untrusted buyer destination");
  return fetch(url, { ...init, redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(30_000) });
}

export { readBoundedJson as readBuyerJson } from "../read-bounded-json";
