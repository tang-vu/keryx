import { BUYER_ORIGIN } from "./protocol";

export type BuyerFetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Never forward a payment signature through a redirect or to another origin. */
export async function buyerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const destination = new URL(url);
  if (destination.origin !== BUYER_ORIGIN || destination.username || destination.password) throw new Error("Untrusted buyer destination");
  const deadline = AbortSignal.timeout(30_000);
  const signal = init.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
  return fetch(url, { ...init, redirect: "error", credentials: "omit", cache: "no-store", signal });
}

export { readBoundedJson as readBuyerJson } from "../read-bounded-json";
