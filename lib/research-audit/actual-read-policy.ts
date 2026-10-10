/** Actual post-portfolio checkpoints. No IO, source truth or payment authority. */
export const ACTUAL_READ_POLICY = "actual-post-portfolio-read-v1" as const;
export type PlannedReadAction = "BUY" | "SKIP" | "CACHE";
export type CheckpointAction = PlannedReadAction | "CONTINUE" | "STOP" | "ESCALATE" | "FREE";
export type ReadCheck =
  | { kind: "selection"; plan: PlannedReadAction; external: boolean }
  | { kind: "duplicate"; found: boolean }
  | { kind: "present"; found: boolean }
  | { kind: "funding"; unavailable: boolean; positivePrice: boolean }
  | { kind: "terms"; allowed: boolean }
  | { kind: "rights"; allowed: boolean }
  | { kind: "review"; required: boolean }
  | { kind: "review-verdict"; verdict: "admitted" | "source-changed" | "human-withheld" }
  | { kind: "public-route"; available: boolean }
  | { kind: "channel"; creatorFree: boolean; cache: boolean }
  | { kind: "zero-budget"; zero: boolean }
  | { kind: "sufficiency"; sufficient: boolean; unavailable: boolean }
  | { kind: "expansion"; unavailable: boolean; sufficient: boolean; gaps: number; rounds: number; reads: number }
  | { kind: "attention"; used: number; limit: number }
  | { kind: "recommendation"; more: boolean; count: number }
  | { kind: "discussion"; excluded: boolean }
  | { kind: "budget"; present: boolean; gathered: boolean; price: string; remaining: string };

export const READ_CHECK_RULES = ["selected-plan", "external-only", "plan-skip", "duplicate", "missing-source", "funding-unavailable",
  "terms", "rights", "human-review", "admitted", "source-changed", "human-withheld", "delivery-channel", "public-channel",
  "zero-budget", "assessment-unavailable", "sufficiency", "expansion", "attention", "engine-recommendation", "discussion", "budget"] as const;
export interface CheckpointOutcome { action: CheckpointAction; rule: typeof READ_CHECK_RULES[number] }

/** Finite canonical decimal preserves the original Number operand, without rounding. */
export function numberOperand(value: number): string {
  if (!Number.isFinite(value)) throw Error("Invalid checkpoint operand");
  return Object.is(value, -0) ? "-0" : String(value);
}
function operand(value: unknown): number {
  if (typeof value !== "string" || value.length > 32 || numberOperand(Number(value)) !== value)
    throw Error("Invalid checkpoint operand");
  return Number(value);
}

/** Consistency check only; mirrors the existing no-rounding decimal converter. */
export function operandMicros(value: string): string | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || Object.is(number, -0)) return null;
  const match = String(number).match(/^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/);
  return match ? (BigInt(match[1]) * BigInt(1_000_000) + BigInt((match[2] ?? "").padEnd(6, "0"))).toString() : null;
}

export function closedFields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  checkpointData(value, names);
}
export function checkpointData(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid checkpoint object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw Error("Invalid checkpoint prototype");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== names.length || names.some(name => !descriptors[name] || !("value" in descriptors[name])))
    throw Error("Unknown checkpoint field");
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
export const READ_CHECK_SHAPES = {
  selection: { plan: "plan", external: "boolean" }, duplicate: { found: "boolean" }, present: { found: "boolean" },
  funding: { unavailable: "boolean", positivePrice: "boolean" }, terms: { allowed: "boolean" }, rights: { allowed: "boolean" },
  review: { required: "boolean" }, "review-verdict": { verdict: "verdict" }, "public-route": { available: "boolean" },
  channel: { creatorFree: "boolean", cache: "boolean" }, "zero-budget": { zero: "boolean" },
  sufficiency: { sufficient: "boolean", unavailable: "boolean" },
  expansion: { unavailable: "boolean", sufficient: "boolean", gaps: "integer", rounds: "integer", reads: "integer" },
  attention: { used: "integer", limit: "integer" }, recommendation: { more: "boolean", count: "integer" },
  discussion: { excluded: "boolean" }, budget: { present: "boolean", gathered: "boolean", price: "operand", remaining: "operand" },
} as const;
const shapes = READ_CHECK_SHAPES;

/** Copy only closed data properties; never invoke an input accessor. */
export function readCheck(value: unknown): ReadCheck {
  if (!value || typeof value !== "object") throw Error("Invalid checkpoint");
  const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
  const kind = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (typeof kind !== "string" || !Object.hasOwn(shapes, kind)) throw Error("Unknown checkpoint");
  const shape = shapes[kind as keyof typeof shapes];
  const fields = checkpointData(value, ["kind", ...Object.keys(shape)]);
  const copy: Record<string, unknown> = { kind };
  for (const [key, type] of Object.entries(shape)) {
    const entry = fields[key];
    if (type === "boolean" && typeof entry !== "boolean" ||
      type === "integer" && (!Number.isSafeInteger(entry) || (entry as number) < 0 || (entry as number) > 10000) ||
      type === "plan" && !["BUY", "SKIP", "CACHE"].includes(entry as string) ||
      type === "verdict" && !["admitted", "source-changed", "human-withheld"].includes(entry as string))
      throw Error("Invalid checkpoint assertion");
    if (type === "operand") operand(entry);
    copy[key] = entry;
  }
  return copy as unknown as ReadCheck;
}

/** Execution calls this evaluator regardless of whether capture is available. */
export function actualReadCheckpoint(check: ReadCheck): CheckpointOutcome {
  const result = (action: CheckpointAction, rule: CheckpointOutcome["rule"]): CheckpointOutcome => ({ action, rule });
  switch (check.kind) {
    case "selection": return check.plan === "SKIP" || check.external ? result("SKIP", check.external ? "external-only" : "plan-skip") : result("CONTINUE", "selected-plan");
    case "duplicate": return result(check.found ? "SKIP" : "CONTINUE", "duplicate");
    case "present": return result(check.found ? "CONTINUE" : "SKIP", "missing-source");
    case "funding": return result(check.unavailable && check.positivePrice ? "SKIP" : "CONTINUE", "funding-unavailable");
    case "terms": return result(check.allowed ? "CONTINUE" : "SKIP", "terms");
    case "rights": return result(check.allowed ? "CONTINUE" : "SKIP", "rights");
    case "review": return result(check.required ? "ESCALATE" : "CONTINUE", "human-review");
    case "review-verdict": return result(check.verdict === "admitted" ? "CONTINUE" : "SKIP", check.verdict);
    case "public-route": return result(check.available ? "FREE" : "CONTINUE", "public-channel");
    case "channel": return result(check.creatorFree ? "FREE" : check.cache ? "CACHE" : "BUY", "delivery-channel");
    case "zero-budget": return result(check.zero ? "SKIP" : "CONTINUE", "zero-budget");
    case "sufficiency": return result(check.unavailable || check.sufficient ? "STOP" : "CONTINUE", check.unavailable ? "assessment-unavailable" : "sufficiency");
    case "expansion": return result(check.unavailable || check.sufficient && check.gaps === 0 && check.rounds > 0 || check.reads <= 0 || check.rounds <= 0 ? "STOP" : "CONTINUE", "expansion");
    case "attention": return result(check.used >= check.limit ? "STOP" : "CONTINUE", "attention");
    case "recommendation": return result(!check.more || check.count === 0 ? "STOP" : "CONTINUE", "engine-recommendation");
    case "discussion": return result(check.excluded ? "SKIP" : "CONTINUE", "discussion");
    case "budget": {
      const price = Number(check.price), remaining = Number(check.remaining);
      return !check.present ? result("SKIP", "missing-source") : check.gathered ? result("SKIP", "duplicate") :
        (remaining <= 0 && price > 0) || price > remaining + 1e-9 ? result("SKIP", "budget") : result("CONTINUE", "budget");
    }
  }
}
