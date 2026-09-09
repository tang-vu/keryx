import { prepareReceiptIntegrity } from "./receipt-integrity-core";
import type { ReceiptVerification } from "./research-receipt-types";

/** Secure-context Web Crypto only. Never fall back to a server's digest assertion. */
export async function browserSha256(value: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function verifyBrowserReceipt(value: unknown): Promise<ReceiptVerification> {
  const prepared = prepareReceiptIntegrity(value);
  if (!prepared.ok) return prepared.verification;
  try {
    const expectedDigest = await browserSha256(prepared.canonical);
    const actualDigest = prepared.actualDigest;
    return { valid: expectedDigest === actualDigest, expectedDigest, actualDigest,
      ...(expectedDigest === actualDigest ? {} : { reason: "payload digest mismatch" }) };
  } catch {
    return { valid: false, reason: "Browser SHA-256 verification is unavailable" };
  }
}
