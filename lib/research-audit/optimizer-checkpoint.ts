import { checkpointData, numberOperand } from "./actual-read-policy";
import { decimalMicros } from "./exact-units";
import { MAX_OPTIMIZER_TIES, OPTIMIZER_REPLAY_V1, replayOptimizer, statePairKey,
  type OptimizerCandidate, type OptimizerInput, type OptimizerOutcome, type StateTie } from "./optimizer-policy-v1";

export type OptimizerCheckpoint = { status: "unavailable"; reason: "unsupported-input" | "capture-bound" | "source-policy-mismatch" | "capture-failed" } |
  { status: "available"; policy: typeof OPTIMIZER_REPLAY_V1; sourcePolicy: "claim-coverage-v1"; facts: "assertions";
    input: OptimizerInput; ties: StateTie[]; outcome: OptimizerOutcome };
function integer(value: unknown, max: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw Error("Invalid optimizer integer");
}
function array<T>(value: unknown, max: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw Error("Invalid optimizer array");
  const fields = Object.getOwnPropertyDescriptors(value as object), length: unknown = fields.length?.value; integer(length, max);
  if (Reflect.ownKeys(value).length !== length + 1) throw Error("Invalid optimizer array fields");
  return Array.from({ length }, (_, index) => { const field = fields[index]; if (!field || !("value" in field)) throw Error("Invalid optimizer array entry"); return parse(field.value); });
}
function refs(value: unknown, max = 10000) { return array(value, max, value => { integer(value, 10000); return value; }); }
function operand(value: unknown): string {
  if (typeof value !== "string" || value.length > 32 || numberOperand(Number(value)) !== value) throw Error("Invalid optimizer operand"); return value;
}
function amount(value: unknown, original: string): string | null {
  const expected = decimalMicros(Number(original)); if (value !== expected) throw Error("Invalid optimizer amount assertion"); return expected;
}
export function optimizerCheckpoint(value: unknown): OptimizerCheckpoint {
  const status = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status") : undefined;
  if (status && "value" in status && status.value === "unavailable") {
    const row = checkpointData(value, ["status", "reason"]);
    if (!["unsupported-input", "capture-bound", "source-policy-mismatch", "capture-failed"].includes(row.reason as string)) throw Error("Unsupported optimizer refusal");
    return row as unknown as OptimizerCheckpoint;
  }
  const row = checkpointData(value, ["status", "policy", "sourcePolicy", "facts", "input", "ties", "outcome"]);
  if (row.status !== "available" || row.policy !== OPTIMIZER_REPLAY_V1 || row.sourcePolicy !== "claim-coverage-v1" || row.facts !== "assertions") throw Error("Unsupported optimizer checkpoint");
  const fields = checkpointData(row.input, ["claimCount", "attentionLimit", "fetchBudget", "fetchBudgetMicros", "candidates"]);
  integer(fields.claimCount, 32); integer(fields.attentionLimit, 32); const fetchBudget = operand(fields.fetchBudget);
  const candidates = array(fields.candidates, 256, value => {
    const item = checkpointData(value, ["candidate", "documentGroup", "idRank", "action", "price", "priceMicros", "expectedValue", "targets", "public"]);
    integer(item.candidate, 10000); integer(item.documentGroup, 256); integer(item.idRank, 255);
    if (!item.candidate || !item.documentGroup || !["BUY", "SKIP", "CACHE"].includes(item.action as string) || typeof item.public !== "boolean") throw Error("Invalid optimizer candidate");
    const price = operand(item.price); operand(item.expectedValue); amount(item.priceMicros, price);
    return { ...item, targets: refs(item.targets) } as unknown as OptimizerCandidate;
  });
  if (new Set(candidates.map(item => item.candidate)).size !== candidates.length || candidates.some(item => item.idRank >= candidates.length)) throw Error("Invalid optimizer identities");
  const input: OptimizerInput = { claimCount: fields.claimCount, attentionLimit: fields.attentionLimit, fetchBudget,
    fetchBudgetMicros: amount(fields.fetchBudgetMicros, fetchBudget), candidates };
  const seen = new Set<string>();
  const ties = array(row.ties, MAX_OPTIMIZER_TIES, value => {
    const fields = checkpointData(value, ["left", "right", "comparison"]), left = refs(fields.left, 48), right = refs(fields.right, 48);
    for (const side of [left, right]) if (side.some((ref, index) => !candidates.some(item => item.candidate === ref) || index > 0 && ref <= side[index - 1])) throw Error("Invalid optimizer tie identity");
    if (![-1, 0, 1].includes(fields.comparison as number)) throw Error("Invalid optimizer comparison");
    const key = statePairKey(left, right), reverse = statePairKey(right, left), pair = key < reverse ? key : reverse;
    if (key === reverse || seen.has(pair)) throw Error("Invalid optimizer tie duplication"); seen.add(pair);
    return { left, right, comparison: fields.comparison as StateTie["comparison"] };
  });
  const expected = replayOptimizer(input, ties), output = checkpointData(row.outcome,
    ["selectionMethod", "evaluatedStates", "eligibleCandidates", "attentionLimit", "selected", "cap", "reserved", "unused", "capMicros", "reservedMicros", "unusedMicros", "predictedCoveredClaims", "claims"]);
  const claims = array(output.claims, 32, value => { const row = checkpointData(value, ["claimIndex", "selected", "coverage"]);
    integer(row.claimIndex, 31); return { claimIndex: row.claimIndex, selected: refs(row.selected, 48), coverage: operand(row.coverage) }; });
  const outcome = { ...output, selected: refs(output.selected, 48), claims };
  if (JSON.stringify(outcome) !== JSON.stringify(expected)) throw Error("Optimizer replay disagreement");
  return { status: "available", policy: OPTIMIZER_REPLAY_V1, sourcePolicy: "claim-coverage-v1", facts: "assertions", input, ties, outcome: expected };
}
