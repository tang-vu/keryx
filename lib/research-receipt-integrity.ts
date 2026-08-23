import { createHash } from "node:crypto";

import {
  RESEARCH_RECEIPT_CANONICALIZATION,
  RESEARCH_RECEIPT_SCHEMA,
  type ReceiptVerification,
  type ResearchReceipt,
  type ResearchReceiptPayload,
} from "./research-receipt-types";

export function researchReceiptDigest(payload: unknown): `sha256:${string}` {
  return sha256(canonicalJson(payload));
}

export function verifyResearchReceipt(value: unknown): ReceiptVerification {
  if (!value || typeof value !== "object") {
    return { valid: false, reason: "receipt must be an object" };
  }
  const receipt = value as Partial<ResearchReceipt>;
  if (Object.keys(value).sort().join(",") !== "integrity,payload") {
    return { valid: false, reason: "receipt has unsupported top-level fields" };
  }
  if (!receipt.payload || typeof receipt.payload !== "object" || !receipt.integrity) {
    return { valid: false, reason: "receipt payload or integrity block is missing" };
  }
  if (
    typeof receipt.integrity !== "object" ||
    Object.keys(receipt.integrity).sort().join(",") !==
      "algorithm,canonicalization,digest,scope"
  ) {
    return { valid: false, reason: "receipt has an unsupported integrity block" };
  }
  if (
    receipt.integrity.algorithm !== "sha256" ||
    receipt.integrity.canonicalization !== RESEARCH_RECEIPT_CANONICALIZATION ||
    receipt.integrity.scope !== "payload" ||
    typeof receipt.integrity.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.integrity.digest)
  ) {
    return { valid: false, reason: "unsupported receipt integrity scheme" };
  }
  if ((receipt.payload as Partial<ResearchReceiptPayload>).schema !== RESEARCH_RECEIPT_SCHEMA) {
    return { valid: false, reason: "unsupported receipt schema" };
  }

  try {
    const expectedDigest = researchReceiptDigest(receipt.payload);
    const actualDigest = receipt.integrity.digest;
    return {
      valid: expectedDigest === actualDigest,
      expectedDigest,
      actualDigest,
      ...(expectedDigest === actualDigest ? {} : { reason: "payload digest mismatch" }),
    };
  } catch {
    return { valid: false, reason: "receipt payload is not canonical JSON data" };
  }
}

/** Stable JSON with recursively sorted keys. Unsupported and non-finite values fail closed. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number is not canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`);
}

export function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
