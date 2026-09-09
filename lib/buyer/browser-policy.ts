import { a2aOrderIdentity } from "../a2a/order-identity";
import { browserSha256 } from "../browser-receipt-integrity";
import { authorizationSchema, authorizationWithNonce, BUYER_NETWORK, type BuyerAuthorization, type BuyerRequirement } from "./protocol";

export function browserNewAuthorization(payer: string, requirement: BuyerRequirement, now = Date.now()): BuyerAuthorization {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const nonce = `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  return authorizationWithNonce(payer, requirement, nonce, now);
}

export async function browserBuyerJobId(value: BuyerAuthorization): Promise<string> {
  const authorization = authorizationSchema.parse(value);
  const digest = await browserSha256(a2aOrderIdentity({ network: BUYER_NETWORK,
    payer: authorization.from, payee: authorization.to, authorizationId: authorization.nonce }));
  return `a2a_${digest.slice(7)}`;
}

/** ASCII-safe base64 of UTF-8 JSON; no Buffer or signature persistence. */
export function encodeBrowserPayment(value: { signature: string; authorization: BuyerAuthorization }): string {
  if (!/^0x[a-fA-F0-9]{130}$/.test(value.signature)) throw new Error("Invalid EOA signature");
  const authorization = authorizationSchema.parse(value.authorization);
  const bytes = new TextEncoder().encode(JSON.stringify({ signature: value.signature, authorization }));
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
}
