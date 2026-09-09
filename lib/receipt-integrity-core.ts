import { canonicalJson } from "./canonical-json";
import {
  RESEARCH_RECEIPT_CANONICALIZATION,
  RESEARCH_RECEIPT_SCHEMA,
  type ReceiptVerification,
  type ResearchReceipt,
  type ResearchReceiptPayload,
} from "./research-receipt-types";

export function prepareReceiptIntegrity(value: unknown): { ok: true; canonical: string; actualDigest: string } | { ok: false; verification: ReceiptVerification } {
  if (!value || typeof value !== "object") {
    return { ok: false, verification: { valid: false, reason: "receipt must be an object" } };
  }
  const receipt = value as Partial<ResearchReceipt>;
  if (Object.keys(value).sort().join(",") !== "integrity,payload") {
    return { ok: false, verification: { valid: false, reason: "receipt has unsupported top-level fields" } };
  }
  if (!receipt.payload || typeof receipt.payload !== "object" || !receipt.integrity) {
    return { ok: false, verification: { valid: false, reason: "receipt payload or integrity block is missing" } };
  }
  if (
    typeof receipt.integrity !== "object" ||
    Object.keys(receipt.integrity).sort().join(",") !==
      "algorithm,canonicalization,digest,scope"
  ) {
    return { ok: false, verification: { valid: false, reason: "receipt has an unsupported integrity block" } };
  }
  if (
    receipt.integrity.algorithm !== "sha256" ||
    receipt.integrity.canonicalization !== RESEARCH_RECEIPT_CANONICALIZATION ||
    receipt.integrity.scope !== "payload" ||
    typeof receipt.integrity.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.integrity.digest)
  ) {
    return { ok: false, verification: { valid: false, reason: "unsupported receipt integrity scheme" } };
  }
  if ((receipt.payload as Partial<ResearchReceiptPayload>).schema !== RESEARCH_RECEIPT_SCHEMA) {
    return { ok: false, verification: { valid: false, reason: "unsupported receipt schema" } };
  }

  try {
    return { ok: true, canonical: canonicalJson(receipt.payload), actualDigest: receipt.integrity.digest };
  } catch {
    return { ok: false, verification: { valid: false, reason: "receipt payload is not canonical JSON data" } };
  }
}

