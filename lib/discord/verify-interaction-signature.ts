/**
 * Ed25519 signature check for Discord interaction webhooks.
 *
 * Discord signs every interaction POST with the application's Ed25519 key and requires the
 * endpoint to reject invalid signatures with a 401 (it probes with deliberately bad signatures
 * during endpoint setup). Node's crypto verifies Ed25519 natively, so no dependency is needed —
 * the raw 32-byte public key from the Developer Portal just has to be wrapped in the fixed
 * SPKI DER header Node expects.
 */

import { createPublicKey, verify } from "node:crypto";

// DER prefix declaring "SPKI, algorithm Ed25519, 32-byte raw key follows".
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** True only when `signatureHex` is a valid Ed25519 signature over timestamp+rawBody. Never throws. */
export function verifyInteractionSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): boolean {
  try {
    const rawKey = Buffer.from(publicKeyHex, "hex");
    if (rawKey.length !== 32) return false;
    const signature = Buffer.from(signatureHex, "hex");
    if (signature.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, signature);
  } catch {
    return false;
  }
}
