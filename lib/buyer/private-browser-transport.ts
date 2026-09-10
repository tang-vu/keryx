import { BUYER_ORIGIN } from "./protocol";
import type { BuyerFetch } from "./transport";

const routes = new Map([
  ["/api/auth/session", "GET"], ["/api/me/private-jobs/quote", "POST"],
  ["/api/me/private-jobs/result", "POST"], ["/api/agent/private-ask", "POST"],
]);

/** Use the HttpOnly account session only at the exact same-origin private endpoints. */
export const privateBrowserFetch: BuyerFetch = async (url, init = {}) => {
  const destination = new URL(url);
  if (globalThis.location?.origin !== BUYER_ORIGIN || destination.origin !== BUYER_ORIGIN
    || destination.username || destination.password || destination.search || destination.hash
    || routes.get(destination.pathname) !== (init.method ?? "GET")) throw new Error("Private browser destination unavailable");
  const deadline = AbortSignal.timeout(30_000);
  return fetch(url, { ...init, redirect: "error", credentials: "same-origin", cache: "no-store",
    signal: init.signal ? AbortSignal.any([deadline, init.signal]) : deadline });
};
