import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json";
import { prepareReceiptIntegrity } from "./receipt-integrity-core";
import type { ReceiptVerification } from "./research-receipt-types";
export { canonicalJson } from "./canonical-json";

export function researchReceiptDigest(payload: unknown): `sha256:${string}` {
  return sha256(canonicalJson(payload));
}

export function verifyResearchReceipt(value: unknown): ReceiptVerification {
  const prepared = prepareReceiptIntegrity(value);
  if (!prepared.ok) return prepared.verification;
  const expectedDigest = sha256(prepared.canonical);
  const actualDigest = prepared.actualDigest;
  return { valid: expectedDigest === actualDigest, expectedDigest, actualDigest,
    ...(expectedDigest === actualDigest ? {} : { reason: "payload digest mismatch" }) };
}

export function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
