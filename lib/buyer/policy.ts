import { randomBytes } from "node:crypto";
import { a2aOrderId } from "../a2a/order";
import { authorizationWithNonce, BUYER_NETWORK, type BuyerAuthorization, type BuyerRequirement } from "./protocol";
export * from "./protocol";

/** Node adapter: the browser uses Web Crypto without importing server modules. */
export function newAuthorization(payer: string, requirement: BuyerRequirement, now = Date.now()): BuyerAuthorization {
  return authorizationWithNonce(payer, requirement, `0x${randomBytes(32).toString("hex")}`, now);
}

export function buyerJobId(authorization: BuyerAuthorization): string {
  return a2aOrderId({ network: BUYER_NETWORK, payer: authorization.from, payee: authorization.to, authorizationId: authorization.nonce });
}
