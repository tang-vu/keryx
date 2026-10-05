import { decodeJwt, decodeProtectedHeader } from "jose";

/** Circle Web SDK 1.1.11 uses jsonwebtoken solely to decode Google's nonce before
 * submitting the token to its verification iframe. This browser-only adapter avoids
 * Node crypto/stream imports. Decoding supplies no identity or signing authority:
 * Circle verifies Google, then Keryx independently verifies Circle's token-wallet binding. */
export function decode(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length > 16384) return null;
  try { decodeProtectedHeader(token); return decodeJwt(token); } catch { return null; }
}
