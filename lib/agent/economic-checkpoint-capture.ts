import { numberOperand } from "../research-audit/actual-read-policy";
import { decimalMicros } from "../research-audit/exact-units";
import { EconomicUnavailable, type AllocationInput, type BudgetOperation, type EconomicEvent, type EconomicPayload } from "../research-audit/economic-checkpoint";

function exact(value: number): string {
  const micros = decimalMicros(value);
  if (micros === null) throw new EconomicUnavailable("nonmicro-input");
  return micros;
}
/** All outcomes come from the live seam, never from the replay result. */
export function captureBudget(operation: BudgetOperation, event: EconomicEvent, before: number, amounts: number[], after: number): EconomicPayload {
  return { kind: "query-budget", event, input: { operation, before: numberOperand(before), operands: amounts.map(numberOperand) },
    outcome: { beforeMicros: exact(before), afterMicros: exact(after) } };
}
export function captureAllocation(sourceTotal: number, total: number, sources: string[], proposed: { sourceId: string; weight: number }[],
  eligible: boolean[], weights: number[], gross: number[], rewards: number[]): EconomicPayload {
  // The proposal can contain invalid numeric weights; preserve that fact without invoking getters or disclosing identities/rationale.
  if (sources.length > 256 || proposed.length > 256) throw new EconomicUnavailable("bounds");
  const groups = new Map<string, number>();
  for (const source of sources) if (!groups.has(source)) groups.set(source, groups.size + 1);
  const descriptors = Object.getOwnPropertyDescriptors(proposed as object), length = descriptors.length?.value;
  if (!Array.isArray(proposed) || Object.getPrototypeOf(proposed) !== Array.prototype || length !== proposed.length || Reflect.ownKeys(proposed).length !== length + 1)
    throw new EconomicUnavailable("invalid-input");
  const proposals: AllocationInput["proposals"] = Array.from({ length }, (_, i) => {
    if (!descriptors[i] || !("value" in descriptors[i])) throw new EconomicUnavailable("invalid-input");
    const fields = Object.getOwnPropertyDescriptors(descriptors[i].value);
    if (!fields.sourceId || !("value" in fields.sourceId) || typeof fields.sourceId.value !== "string" ||
        !fields.weight || !("value" in fields.weight) || typeof fields.weight.value !== "number") throw new EconomicUnavailable("invalid-input");
    return { group: groups.get(fields.sourceId.value) ?? 0, weight: Number.isFinite(fields.weight.value) ? numberOperand(fields.weight.value) : null };
  });
  return { kind: "citation-allocation", event: "attribution",
    input: { sourceTotal: numberOperand(sourceTotal), total: numberOperand(total), groups: sources.map(source => groups.get(source)!), proposals, eligible },
    outcome: { weights: weights.map(numberOperand), grossMicros: gross.map(exact), rewardsMicros: rewards.map(exact) } };
}
export function captureAuthorSplit(total: number, weights: number[], legs: number[]): EconomicPayload {
  return { kind: "author-split", event: "authors", input: { total: numberOperand(total), weights: weights.map(numberOperand) },
    outcome: { legMicros: legs.map(exact) } };
}
