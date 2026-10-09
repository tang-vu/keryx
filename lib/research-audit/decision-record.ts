import { micros } from "./exact-units";

export const READ_POLICY_VERSION = "bounded-read-admission-v1" as const;
export type ReadAction = "BUY" | "SKIP" | "CACHE" | "STOP" | "ESCALATE";
export interface ReadPolicyInput {
  /** Opaque candidate identifier only: no question, name, URL, rationale or body. */
  candidateId: string;
  proposal: ReadAction;
  priceMicros: string;
  budgetRemainingMicros: string;
  priceCeilingMicros: string;
  attentionRemaining: number;
  eligible: boolean;
  external: boolean;
  cacheFresh: boolean;
  sufficient: boolean;
  requiresApproval: boolean;
}
export interface ReadPolicyResult { action: ReadAction; reservedMicros: string; rule: string }
export interface DecisionRecord {
  schema: 1;
  policy: typeof READ_POLICY_VERSION;
  input: ReadPolicyInput;
  outcome: ReadPolicyResult;
}

function fields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid record object");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error("Invalid record prototype");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== names.length || names.some(name => !descriptors[name] || !("value" in descriptors[name])))
    throw new Error("Unexpected or missing record field");
}

export function readPolicyInput(value: unknown): ReadPolicyInput {
  fields(value, ["candidateId", "proposal", "priceMicros", "budgetRemainingMicros", "priceCeilingMicros",
    "attentionRemaining", "eligible", "external", "cacheFresh", "sufficient", "requiresApproval"]);
  if (typeof value.candidateId !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(value.candidateId)) throw new Error("Invalid opaque candidate ID");
  if (!["BUY", "SKIP", "CACHE", "STOP", "ESCALATE"].includes(value.proposal as string)) throw new Error("Invalid proposal");
  for (const key of ["priceMicros", "budgetRemainingMicros", "priceCeilingMicros"] as const) micros(value[key] as string);
  if (!Number.isSafeInteger(value.attentionRemaining) || (value.attentionRemaining as number) < 0
    || (value.attentionRemaining as number) > 10000) throw new Error("Invalid attention remaining");
  for (const key of ["eligible", "external", "cacheFresh", "sufficient", "requiresApproval"] as const)
    if (typeof value[key] !== "boolean") throw new Error("Invalid policy flag");
  return { candidateId: value.candidateId, proposal: value.proposal as ReadAction, priceMicros: value.priceMicros as string,
    budgetRemainingMicros: value.budgetRemainingMicros as string, priceCeilingMicros: value.priceCeilingMicros as string,
    attentionRemaining: value.attentionRemaining as number, eligible: value.eligible as boolean, external: value.external as boolean,
    cacheFresh: value.cacheFresh as boolean, sufficient: value.sufficient as boolean, requiresApproval: value.requiresApproval as boolean };
}

/** Pure, versioned prospective admission subpolicy. This function never signs, fetches or settles. */
export function replayReadPolicy(value: ReadPolicyInput): ReadPolicyResult {
  const input = readPolicyInput(value);
  const outcome = (action: ReadAction, rule: string, reservedMicros = "0") => ({ action, rule, reservedMicros });
  if (input.sufficient || input.proposal === "STOP") return outcome("STOP", "reading-complete");
  if (input.proposal === "SKIP") return outcome("SKIP", "model-skip");
  if (!input.eligible || input.external) return outcome("SKIP", "source-not-admitted");
  if (input.attentionRemaining === 0) return outcome("STOP", "attention-exhausted");
  if (input.requiresApproval || input.proposal === "ESCALATE") return outcome("ESCALATE", "approval-required");
  if (input.cacheFresh) return outcome("CACHE", "exact-version-cache");
  if (micros(input.priceMicros) > micros(input.priceCeilingMicros)) return outcome("SKIP", "price-ceiling");
  if (micros(input.priceMicros) > micros(input.budgetRemainingMicros)) return outcome("SKIP", "fetch-budget");
  return outcome("BUY", input.proposal === "CACHE" ? "cache-expired" : "model-buy", input.priceMicros);
}

export function createDecisionRecord(value: ReadPolicyInput): DecisionRecord {
  const input = readPolicyInput(value);
  return { schema: 1, policy: READ_POLICY_VERSION, input, outcome: replayReadPolicy(input) };
}

/** Canonical closed JSON, fixed key order. Unknown fields cannot sneak private text into a hash. */
export function canonicalDecisionRecord(value: unknown): string {
  fields(value, ["schema", "policy", "input", "outcome"]);
  if (value.schema !== 1 || value.policy !== READ_POLICY_VERSION) throw new Error("Unsupported decision policy");
  const input = readPolicyInput(value.input);
  fields(value.outcome, ["action", "rule", "reservedMicros"]);
  const outcome = value.outcome;
  if (!["BUY", "SKIP", "CACHE", "STOP", "ESCALATE"].includes(outcome.action as string)
    || typeof outcome.rule !== "string" || !/^[a-z-]{1,64}$/.test(outcome.rule)) throw new Error("Invalid decision outcome");
  micros(outcome.reservedMicros as string);
  return JSON.stringify({ schema: 1, policy: READ_POLICY_VERSION, input,
    outcome: { action: outcome.action, reservedMicros: outcome.reservedMicros, rule: outcome.rule } });
}

/** Browser Web Crypto works offline. A digest alone is integrity, never independent attestation. */
export async function decisionRecordHash(record: unknown): Promise<string> {
  return hashCanonicalRecord(canonicalDecisionRecord(record));
}

async function hashCanonicalRecord(canonical: string): Promise<string> {
  const data = new TextEncoder().encode(canonical);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Expected hash must be retained separately by the caller; a rewritten record/hash pair is untrusted. */
export async function verifyDecisionRecord(record: unknown, expectedHash: string): Promise<boolean> {
  try {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
    const canonical = canonicalDecisionRecord(record);
    if (await hashCanonicalRecord(canonical) !== expectedHash || canonicalDecisionRecord(record) !== canonical) return false;
    const parsed = JSON.parse(canonical) as DecisionRecord;
    return JSON.stringify(parsed.outcome) === JSON.stringify({ action: replayReadPolicy(parsed.input).action,
      reservedMicros: replayReadPolicy(parsed.input).reservedMicros, rule: replayReadPolicy(parsed.input).rule });
  } catch { return false; }
}
